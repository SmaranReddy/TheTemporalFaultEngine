import { env } from "../config/env.js";
import { redis } from "../redis/index.js";
import { acquire } from "../leases/index.js";
import { logger } from "../logger/index.js";

const SCHEDULER_KEY = "scheduler";

export interface SchedulerController {
  start(): void;
  stop(): void;
}

/**
 * ─── Precision Scheduler ─────────────────────────────────────────
 *
 * Uses a Redis sorted set as the scheduling queue:
 *
 *   ZADD tfe:scheduler <epoch_ms> <eventId>
 *
 * The score is the event's scheduled_at timestamp in epoch milliseconds.
 * This gives us O(log N) insertion and O(log N) range queries.
 *
 * Why Redis, not PostgreSQL?
 *   PostgreSQL could do this with SELECT ... ORDER BY scheduled_at LIMIT N.
 *   But that creates lock contention on the events table. Redis offloads
 *   the "what's due next" question to an in-memory data structure.
 *
 * Architecture:
 *   Every worker runs a scheduler loop. They all poll the same Redis
 *   sorted set. Each worker reads the next N due events and tries to
 *   claim them via the DB. The DB's atomic UPDATE (with WHERE status='PENDING')
 *   ensures exactly one worker claims each event. This is the same
 *   optimistic concurrency pattern used throughout the system.
 *
 * Race condition: multiple workers read the same events from Redis
 *   Worker A reads event IDs [1, 2, 3] from ZRANGEBYSCORE.
 *   Worker B reads event IDs [1, 2, 3] from ZRANGEBYSCORE.
 *   Both try acquire(1). One succeeds (DB status='PENDING' matches).
 *   The other gets rowCount=0 and removes the event from Redis.
 *   Result: event 1 is claimed exactly once. No double-execution.
 *
 * Race condition: clock skew between workers
 *   Worker A (clock 2s ahead) fires early and claims events scheduled
 *   for 2s from now. This is acceptable because we'd rather run early
 *   than late. The scheduled_at is the earliest execution time, not
 *   a hard deadline.
 */

export function createScheduler(): SchedulerController {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    try {
      const now = Date.now();
      const batchSize = env.SCHEDULER_BATCH_SIZE;

      // Read due events from Redis sorted set
      // ZRANGEBYSCORE returns members with scores in [0, now]
      const due = await redis.zrangebyscore(
        SCHEDULER_KEY,
        0,
        now,
        "LIMIT",
        0,
        batchSize
      );

      if (due.length === 0) return;

      // Remove them from the sorted set atomically
      // (may fail for individual IDs if another worker got there first)
      await redis.zremrangebyscore(SCHEDULER_KEY, 0, now);

      for (const eventId of due) {
        const claim = await acquire(eventId, env.WORKER_ID);

        if (claim) {
          logger.info(
            {
              eventId: claim.eventId,
              scheduledAt: claim.scheduledAt.toISOString(),
              leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
            },
            "Event claimed from scheduler"
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler tick failed");
    }
  }

  return {
    start(): void {
      if (timer) return;
      logger.info(
        { intervalMs: env.SCHEDULER_POLL_INTERVAL_MS },
        "Scheduler starting"
      );
      timer = setInterval(tick, env.SCHEDULER_POLL_INTERVAL_MS);
    },

    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger.info("Scheduler stopped");
    },
  };
}

/**
 * Add an event to the scheduling queue.
 * Called after inserting a new event into the DB.
 */
export async function addToSchedule(
  eventId: string,
  scheduledAt: Date
): Promise<void> {
  await redis.zadd(SCHEDULER_KEY, scheduledAt.getTime(), eventId);
}

/**
 * Remove an event from the scheduling queue.
 * Called after the reaper reclaims an event (re-add it to schedule).
 */
export async function removeFromSchedule(eventId: string): Promise<void> {
  await redis.zrem(SCHEDULER_KEY, eventId);
}
