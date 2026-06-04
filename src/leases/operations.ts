import { db } from "../db/index.js";
import { events } from "../db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import type { ClaimResult } from "./types.js";
import { eventStatusChanged } from "../api/realtime.js";

/**
 * ─── Lease Expiry Helper ─────────────────────────────────────────
 *
 * CRITICAL: This uses NOW() on the DB server, NOT Date.now() on the
 * application server. If two workers have clock drift, comparing
 * application timestamps against DB timestamps would cause split-brain:
 *   - Worker A (clock 2s ahead) thinks its lease is still valid
 *   - The reaper (using DB time) disagrees and reclaims it
 *
 * All lease comparisons MUST be DB-side.
 */
function leaseExpiry() {
  return sql`NOW() + ${env.LEASE_DURATION_MS}::int * INTERVAL '1 millisecond'`;
}

/**
 * ─── acquire ─────────────────────────────────────────────────────
 *
 * Atomically claim an event by ID.
 *
 * How it works:
 *   1. UPDATE ... SET status='CLAIMED', claimed_by=$workerId, lease=NOW()+30s
 *   2. WHERE id=$eventId AND status='PENDING'
 *   3. RETURNING *
 *
 * If the WHERE clause matches zero rows (event was already claimed by
 * another worker), rowCount is 0 and we return null. There is NO lock
 * contention — PostgreSQL handles this with its MVCC snapshot isolation.
 *
 * Race condition prevented:
 *   Two workers running acquire() simultaneously for the same event.
 *   Only one will match the WHERE status='PENDING' clause. The other
 *   gets rowCount=0. No locks, no deadlocks.
 */
export async function acquire(
  eventId: string,
  workerId: string
): Promise<ClaimResult | null> {
  const [row] = await db
    .update(events)
    .set({
      status: "CLAIMED",
      claimedBy: workerId,
      leaseExpiresAt: leaseExpiry(),
      attemptCount: sql`${events.attemptCount} + 1`,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(eq(events.id, eventId), eq(events.status, "PENDING"))
    )
    .returning();

  if (!row) {
    logger.warn(
      { eventId, workerId },
      "Claim failed — event already claimed or missing"
    );
    return null;
  }

  logger.info(
    { eventId, workerId, leaseExpiresAt: row.leaseExpiresAt },
    "Lease acquired"
  );
  eventStatusChanged(row.id, "CLAIMED");

  return {
    eventId: row.id,
    payload: row.payload,
    scheduledAt: row.scheduledAt,
    leaseExpiresAt: row.leaseExpiresAt!,
    attemptCount: row.attemptCount,
    idempotencyKey: row.idempotencyKey,
  };
}

/**
 * ─── heartbeat ───────────────────────────────────────────────────
 *
 * Extend the lease for an event the worker currently owns.
 *
 * Why this is necessary:
 *   Work may take longer than the initial lease window. The worker
 *   periodically calls heartbeat() to renew. If the worker crashes,
 *   heartbeats stop, the lease expires, and the reaper reclaims.
 *
 * Guard:
 *   WHERE id=$eventId AND claimed_by=$workerId
 *
 * This prevents two failure cases:
 *   1. Worker A heartbeats an event that was already reaped and
 *      reclaimed by Worker B — UPDATE matches 0 rows, returns false.
 *   2. Clock drift — both application and DB use the same NOW().
 */
export async function heartbeat(
  eventId: string,
  workerId: string
): Promise<boolean> {
  const [row] = await db
    .update(events)
    .set({
      leaseExpiresAt: leaseExpiry(),
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.claimedBy, workerId),
        inArray(events.status, ["CLAIMED", "EXECUTING"])
      )
    )
    .returning({ id: events.id });

  if (!row) {
    logger.warn(
      { eventId, workerId },
      "Heartbeat failed — lease no longer held"
    );
    return false;
  }

  return true;
}

/**
 * ─── complete ────────────────────────────────────────────────────
 *
 * Transition an event to EXECUTED and release the lease.
 *
 * Guard:
 *   WHERE id=$eventId AND claimed_by=$workerId
 *
 * If the worker no longer owns this event (reaper reclaimed it),
 * the UPDATE matches 0 rows and we return false — the worker should
 * abort processing.
 */
export async function complete(
  eventId: string,
  workerId: string
): Promise<boolean> {
  const [row] = await db
    .update(events)
    .set({
      status: "EXECUTED",
      executedAt: sql`NOW()`,
      claimedBy: null,
      leaseExpiresAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.claimedBy, workerId),
        inArray(events.status, ["CLAIMED", "EXECUTING"])
      )
    )
    .returning({ id: events.id });

  if (!row) {
    logger.warn(
      { eventId, workerId },
      "Complete failed — worker no longer owns lease"
    );
    return false;
  }

  logger.info({ eventId, workerId }, "Event completed successfully");
  eventStatusChanged(eventId, "EXECUTED");
  return true;
}

/**
 * ─── completeExecution ───────────────────────────────────────────
 *
 * Atomically mark a journal entry as COMPLETED and transition the
 * event to EXECUTED in a single database round-trip (CTE).
 *
 * Replaces the two-round-trip pattern:
 *   1. completeJournal()   ─── UPDATE event_executions → COMPLETED
 *   2. complete()          ─── UPDATE events → EXECUTED
 *
 * Correctness:
 *   - Journal-before-event ordering preserved (journal CTE runs first)
 *   - Atomic: if the DB crashes mid-CTE, neither update takes effect
 *   - No ambiguity window between journal and event status
 *   - Same WHERE guards as the individual functions:
 *       journal: id=$journalId AND execution_status='STARTED'
 *       event:   id=$eventId AND claimed_by=$workerId
 *                AND status IN ('CLAIMED','EXECUTING')
 *
 * Returns:
 *   journalCompleted — true if the journal was in STARTED state
 *   eventCompleted   — true if the worker still owned the lease
 */
export async function completeExecution(
  eventId: string,
  workerId: string,
  journalId: string
): Promise<{ journalCompleted: boolean; eventCompleted: boolean }> {
  try {
    const result = await db.execute(sql`
      WITH journal_update AS (
        UPDATE event_executions
        SET execution_status = 'COMPLETED',
            execution_completed_at = NOW()
        WHERE id = ${journalId} AND execution_status = 'STARTED'
        RETURNING id
      )
      UPDATE events
      SET status = 'EXECUTED',
          executed_at = NOW(),
          claimed_by = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE id = ${eventId}
        AND claimed_by = ${workerId}
        AND status IN ('CLAIMED', 'EXECUTING')
      RETURNING
        (SELECT count(*) FROM journal_update)::int AS journal_updated,
        id AS event_id
    `);

    if (result.rows.length === 0) {
      logger.warn(
        { eventId, workerId },
        "completeExecution failed — worker no longer owns lease"
      );
      return { journalCompleted: false, eventCompleted: false };
    }

    const row = result.rows[0]!;
    const journalCompleted = Number(row.journal_updated) > 0;

    if (!journalCompleted) {
      logger.warn(
        { eventId, journalId },
        "Journal complete failed — but handler finished"
      );
    }

    logger.info({ eventId, workerId }, "Event completed successfully");
    eventStatusChanged(eventId, "EXECUTED");

    return { journalCompleted, eventCompleted: true };
  } catch (err) {
    logger.error({ eventId, workerId, journalId, err }, "completeExecution threw");
    return { journalCompleted: false, eventCompleted: false };
  }
}

/**
 * ─── fail ────────────────────────────────────────────────────────
 *
 * Transition an event to FAILED and release the lease.
 *
 * Same guards as complete(). The event may be retried later if the
 * system supports retry policies (the reaper can reclaim FAILED events).
 */
export async function fail(
  eventId: string,
  workerId: string,
  error: string
): Promise<boolean> {
  const [row] = await db
    .update(events)
    .set({
      status: "FAILED",
      lastError: error,
      claimedBy: null,
      leaseExpiresAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.claimedBy, workerId),
        inArray(events.status, ["CLAIMED", "EXECUTING"])
      )
    )
    .returning({ id: events.id });

  if (!row) {
    logger.warn(
      { eventId, workerId },
      "Fail transition failed — worker no longer owns lease"
    );
    return false;
  }

  logger.info({ eventId, workerId, error }, "Event failed");
  eventStatusChanged(eventId, "FAILED");
  return true;
}

/**
 * ─── beginExecution ──────────────────────────────────────────────
 *
 * Transition CLAIMED → EXECUTING. This signals that the worker has
 * started actual work (not just acquired the lease).
 *
 * Why this matters:
 *   If a worker claims an event but crashes before executing, the
 *   reaper sees status='CLAIMED' and reclaims it. But if we didn't
 *   distinguish CLAIMED from EXECUTING, a worker that crashes mid-work
 *   would lose its lease and another worker might execute the same
 *   work twice. With EXECUTING, the reaper can apply different policies
 *   (e.g., longer grace period for mid-execution crashes).
 */
export async function beginExecution(
  eventId: string,
  workerId: string
): Promise<boolean> {
  const [row] = await db
    .update(events)
    .set({
      status: "EXECUTING",
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.claimedBy, workerId),
        eq(events.status, "CLAIMED")
      )
    )
    .returning({ id: events.id });

  if (!row) {
    logger.warn(
      { eventId, workerId },
      "beginExecution failed — expected CLAIMED status"
    );
    return false;
  }

  eventStatusChanged(eventId, "EXECUTING");
  return true;
}
