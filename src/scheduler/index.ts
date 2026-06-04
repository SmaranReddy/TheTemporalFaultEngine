import { env } from "../config/env.js";
import { redis } from "../redis/index.js";
import { acquire } from "../leases/index.js";
import { executeEvent, simulatedHandler } from "../worker/index.js";
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

      // Remove only the IDs this tick is about to process. Removing the
      // entire due range would drop due-but-unread IDs when backlog exceeds
      // the batch size; schedule recovery can heal that, but this keeps the
      // queue consistent during normal operation.
      await redis.zrem(SCHEDULER_KEY, ...due);

      for (const eventId of due) {
        const claim = await acquire(eventId, env.WORKER_ID);

        if (!claim) continue;

        logger.info(
          {
            eventId: claim.eventId,
            scheduledAt: claim.scheduledAt.toISOString(),
            leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
          },
          "Event claimed — dispatching to executor"
        );

        // Fire-and-forget execution. The executor manages its own
        // heartbeat, timeout, and completion lifecycle.
        // We do NOT await this — the scheduler tick must continue
        // to find and claim the next batch of events.
        executeEvent(claim, simulatedHandler).then((result) => {
          logger.info(
            {
              eventId: claim.eventId,
              result: result.status,
              ...(result.status === "FAILED" && { error: result.error }),
              ...(result.status === "ABORTED" && { reason: result.reason }),
            },
            "Event execution finished"
          );
        }, (err) => {
          logger.error(
            { eventId: claim.eventId, err },
            "Event execution threw unexpectedly"
          );
        });
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
 * Add an event to Redis with bounded retries. If Redis remains unavailable,
 * the DB row stays PENDING and schedule recovery will enqueue it later.
 */
export async function addToScheduleWithRetry(
  eventId: string,
  scheduledAt: Date
): Promise<boolean> {
  const attempts = Math.max(1, env.SCHEDULE_ENQUEUE_RETRY_ATTEMPTS);
  const retryDelayMs = Math.max(0, env.SCHEDULE_ENQUEUE_RETRY_DELAY_MS);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await addToSchedule(eventId, scheduledAt);
      return true;
    } catch (err) {
      logger.warn(
        { eventId, scheduledAt, attempt, attempts, err },
        "Redis schedule enqueue failed"
      );

      if (attempt < attempts && retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }

  logger.error(
    { eventId, scheduledAt },
    "Redis schedule enqueue exhausted retries; recovery will reschedule"
  );
  return false;
}

export async function isInSchedule(eventId: string): Promise<boolean> {
  const score = await redis.zscore(SCHEDULER_KEY, eventId);
  return score !== null;
}

/**
 * Remove an event from the scheduling queue.
 * Called after the reaper reclaims an event (re-add it to schedule).
 */
export async function removeFromSchedule(eventId: string): Promise<void> {
  await redis.zrem(SCHEDULER_KEY, eventId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
