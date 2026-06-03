import { db } from "../db/index.js";
import { events } from "../db/schema.js";
import { and, inArray, lt, isNotNull, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import { addToSchedule } from "../scheduler/index.js";

export interface ReaperController {
  start(): void;
  stop(): void;
}

/**
 * ─── Reaper ───────────────────────────────────────────────────────
 *
 * Background loop that scans for orphaned leases (events where
 * lease_expires_at < NOW() but status is still CLAIMED or EXECUTING).
 *
 * Why this is necessary:
 *   Workers crash. When a worker dies, its leases would be locked
 *   forever. The reaper is the distributed GC that detects stale
 *   leases and resets them to PENDING so other workers can pick them up.
 *
 * Race condition: heartbeat vs reaper
 *   Worker heartbeats extend lease_expires_at. The reaper checks
 *   lease_expires_at < NOW(). If the heartbeat fires between the
 *   reaper's SELECT and its UPDATE, the reaper sees a fresh lease and
 *   skips it. If the reaper fires first and resets to PENDING, the
 *   next heartbeat from the old worker matches 0 rows (status != CLAIMED)
 *   and the worker discovers it lost the lease. This is correct behavior.
 *
 * Race condition: multiple reapers
 *   Every worker runs its own reaper. Two reapers can target the same
 *   row simultaneously. The UPDATE ... WHERE lease_expires_at < NOW()
 *   ensures only one succeeds (first writer wins; second gets rowCount=0).
 *   This is harmless — the row only needs to be reaped once.
 *
 * Race condition: reaper vs acquire
 *   Reaper resets status to PENDING. Meanwhile, acquire() tries to
 *   claim it. If the reaper runs first, acquire() sees PENDING and
 *   claims it — correct. If acquire() runs first, the reaper's WHERE
 *   clause (lease_expires_at < NOW()) may or may not match (if acquire
 *   set a new lease_expires_at in the future, reaper skips it — correct).
 */

export function createReaper(): ReaperController {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function reap(): Promise<void> {
    try {
      const reclaimed = await db
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
            isNotNull(events.leaseExpiresAt),
            lt(events.leaseExpiresAt, sql`NOW()`)
          )
        )
        .returning({ id: events.id, scheduledAt: events.scheduledAt });

      for (const row of reclaimed) {
        logger.warn(
          { eventId: row.id },
          "Lease reaped — event returned to PENDING"
        );
        await addToSchedule(row.id, row.scheduledAt);
      }

      if (reclaimed.length > 0) {
        logger.info({ count: reclaimed.length }, "Reaper cycle complete");
      }
    } catch (err) {
      logger.error({ err }, "Reaper cycle failed");
    }
  }

  return {
    start(): void {
      if (timer) return;
      logger.info(
        { intervalMs: env.LEASE_REAPER_INTERVAL_MS },
        "Reaper starting"
      );
      timer = setInterval(reap, env.LEASE_REAPER_INTERVAL_MS);
    },

    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger.info("Reaper stopped");
    },
  };
}
