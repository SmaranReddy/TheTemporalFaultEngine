import { db } from "../db/index.js";
import { events } from "../db/schema.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import { addToSchedule } from "../scheduler/index.js";

export interface RecoveryResult {
  orphanedLeases: number;
  rescheduled: number;
}

/**
 * ─── recoverOrphanedLeases ────────────────────────────────────────
 *
 * Run ONCE at worker startup. Finds any events that were claimed by
 * THIS worker in a previous lifecycle and resets them to PENDING.
 *
 * Why this is necessary:
 *   If the worker crashes (SIGKILL, OOM, power failure), its in-flight
 *   leases are still marked CLAIMED/EXECUTING in the DB. Without crash
 *   recovery, those events are stuck forever — no other worker can
 *   claim them because claimed_by points to a dead worker.
 *
 * How the reaper also handles this:
 *   The reaper would eventually reclaim these events when lease_expires_at
 *   passes. But the reaper runs every N seconds. Recovery is immediate —
 *   it runs during startup before any other subsystem starts.
 *
 * Edge case: worker restarts quickly after crash
 *   Worker crashes, restarts in 2 seconds. Its leases haven't expired
 *   yet (lease_duration is 30s). The reaper hasn't fired yet. Only crash
 *   recovery can reclaim them immediately.
 */
export async function recoverOrphanedLeases(): Promise<RecoveryResult> {
  const workerId = env.WORKER_ID;

  const recovered = await db
    .update(events)
    .set({
      status: "PENDING",
      claimedBy: null,
      leaseExpiresAt: null,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        inArray(events.status, ["CLAIMED", "EXECUTING"]),
        eq(events.claimedBy, workerId)
      )
    )
    .returning({ id: events.id, scheduledAt: events.scheduledAt });

  let rescheduled = 0;

  for (const event of recovered) {
    await addToSchedule(event.id, event.scheduledAt);
    rescheduled++;
    logger.warn(
      { eventId: event.id, workerId, scheduledAt: event.scheduledAt },
      "Orphaned lease recovered — event rescheduled"
    );
  }

  if (recovered.length > 0) {
    logger.info(
      { count: recovered.length, workerId },
      "Crash recovery complete — orphaned leases reclaimed"
    );
  }

  return {
    orphanedLeases: recovered.length,
    rescheduled,
  };
}
