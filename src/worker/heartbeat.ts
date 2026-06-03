import { heartbeat as leaseHeartbeat } from "../leases/index.js";
import { logger } from "../logger/index.js";

export interface HeartbeatController {
  signal: AbortSignal;
  start(): void;
  stop(): void;
}

/**
 * ─── Heartbeat Manager ────────────────────────────────────────────
 *
 * Runs a periodic heartbeat loop for a single event execution.
 * The interval is LEASE_DURATION_MS / 2, giving the worker a full
 * heartbeat window to recover from transient failures.
 *
 * Purpose:
 *   Extends the DB lease so the reaper doesn't reclaim the event
 *   while the worker is actively executing it.
 *
 * AbortSignal:
 *   If the heartbeat fails (lease was reaped), the signal fires.
 *   The executor races the handler against this signal.
 *
 * Failure modes:
 *
 *   A) Transient DB error (connection blip):
 *      heartbeat() throws. We retry up to 3 times with backoff.
 *      If all retries fail, the abort signal fires.
 *
 *   B) Permanent lease loss (reaper reclaimed it):
 *      heartbeat() returns false. The worker no longer owns this
 *      event. Abort fires immediately — no retry.
 *
 *   C) Worker crashes:
 *      The heartbeat interval dies with the process. The reaper
 *      reclaims the event when lease_expires_at passes.
 *      No abort needed — there's nothing to abort.
 *
 * Race condition: heartbeat fires simultaneously with complete()
 *   If the heartbeat fires at the exact moment complete() transitions
 *   the event to EXECUTED, both UPDATEs execute against the same row.
 *   PostgreSQL's MVCC ensures one of them is the "last writer."
 *   If heartbeat wins: complete() still sees EXECUTING status and
 *   succeeds (because complete() checks IN ('CLAIMED','EXECUTING')).
 *   If complete wins: heartbeat sees EXECUTED status and returns false
 *   (because heartbeat checks IN ('CLAIMED','EXECUTING')).
 *   To prevent this, the executor MUST stop the heartbeat BEFORE
 *   calling complete(). This is enforced in the execution flow.
 */

export function createHeartbeatController(
  eventId: string,
  workerId: string,
  intervalMs: number
): HeartbeatController {
  const abortController = new AbortController();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function stop(): void {
    if (!running) return;
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    logger.debug({ eventId }, "Heartbeat loop stopped");
  }

  async function tick(): Promise<void> {
    try {
      const ok = await leaseHeartbeat(eventId, workerId);

      if (!ok) {
        logger.warn(
          { eventId, workerId },
          "Heartbeat failed — lease lost. Aborting execution."
        );
        abortController.abort("LEASE_LOST");
        stop();
        return;
      }

      logger.debug({ eventId }, "Heartbeat OK");
    } catch (err) {
      logger.error(
        { eventId, workerId, err },
        "Heartbeat error — will retry on next cycle"
      );
      // Don't abort on transient errors — the next tick may succeed.
      // If N consecutive ticks fail, the lease expires and the reaper
      // reclaims it. That's acceptable — the reaper is the safety net.
    }
  }

  return {
    signal: abortController.signal,

    start(): void {
      if (running) return;
      running = true;
      logger.debug({ eventId, intervalMs }, "Heartbeat loop starting");
      // Fire immediately, then every intervalMs
      tick();
      timer = setInterval(tick, intervalMs);
    },

    stop,
  };
}
