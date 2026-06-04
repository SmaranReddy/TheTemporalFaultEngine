import { db } from "../db/index.js";
import { events } from "../db/schema.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import { addToSchedule, isInSchedule } from "../scheduler/index.js";

export interface RecoveryResult {
  orphanedLeases: number;
  rescheduled: number;
}

export interface ScheduleRecoveryController {
  start(): void;
  stop(): void;
}

export interface ScheduleRecoveryResult {
  scanned: number;
  missing: number;
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

/**
 * Reconcile durable PENDING rows back into Redis.
 *
 * This closes the DB INSERT -> Redis ZADD consistency gap. If the DB insert
 * commits but Redis is down, the event remains PENDING in Postgres. This job
 * scans those rows and re-adds any event whose Redis sorted-set member is
 * missing.
 */
export async function recoverMissingPendingSchedules(): Promise<ScheduleRecoveryResult> {
  const pending = await db
    .select({ id: events.id, scheduledAt: events.scheduledAt })
    .from(events)
    .where(eq(events.status, "PENDING"))
    .orderBy(asc(events.scheduledAt))
    .limit(env.SCHEDULE_RECOVERY_BATCH_SIZE);

  let missing = 0;
  let rescheduled = 0;

  for (const event of pending) {
    try {
      if (await isInSchedule(event.id)) continue;

      missing++;
      await addToSchedule(event.id, event.scheduledAt);
      rescheduled++;
      logger.warn(
        { eventId: event.id, scheduledAt: event.scheduledAt },
        "Missing pending event recovered into Redis schedule"
      );
    } catch (err) {
      logger.warn(
        { eventId: event.id, scheduledAt: event.scheduledAt, err },
        "Schedule recovery check failed"
      );
    }
  }

  if (rescheduled > 0) {
    logger.info(
      { scanned: pending.length, missing, rescheduled },
      "Schedule recovery complete"
    );
  }

  return {
    scanned: pending.length,
    missing,
    rescheduled,
  };
}

export function createScheduleRecovery(): ScheduleRecoveryController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await recoverMissingPendingSchedules();
    } catch (err) {
      logger.error({ err }, "Schedule recovery tick failed");
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      logger.info(
        { intervalMs: env.SCHEDULE_RECOVERY_INTERVAL_MS },
        "Schedule recovery starting"
      );
      void tick();
      timer = setInterval(tick, env.SCHEDULE_RECOVERY_INTERVAL_MS);
    },

    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger.info("Schedule recovery stopped");
    },
  };
}
