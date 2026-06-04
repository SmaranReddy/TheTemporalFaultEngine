import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import {
  beginExecution,
  complete,
  completeExecution,
  fail,
} from "../leases/index.js";
import type { ClaimResult } from "../leases/index.js";
import { createHeartbeatController } from "./heartbeat.js";
import { raceExecution } from "./timeout.js";
import {
  isIdempotencyKeyCompleted,
  startJournal,
  failJournal,
} from "./journal.js";

export type ExecutionResult =
  | { status: "EXECUTED" }
  | { status: "SKIPPED" }
  | { status: "FAILED"; error: string }
  | { status: "ABORTED"; reason: string };

export type PayloadHandler = (payload: string) => Promise<void>;

/**
 * ─── executeEvent ─────────────────────────────────────────────────
 *
 * v2 — with idempotency dedup and execution journal.
 *
 * Execution order (CRITICAL — do not reorder):
 *
 *   0. Dedup check        ─── check if idempotency_key already COMPLETED
 *   1. Journal START      ─── INSERT event_executions (status=STARTED)
 *   2. beginExecution()   ─── CLAIMED → EXECUTING
 *   3. Heartbeat loop     ─── extends lease every lease_duration/2
 *   4. raceExecution()    ─── handler vs timeout vs lease-loss abort
 *   5. Stop heartbeat     ─── BEFORE any DB writes
 *   6. completeExecution() ─── CTE: journal COMPLETED + event EXECUTED
 *                              in one atomic DB command
 *
 * Why journal before event status (step 6 before step 7):
 *   Imagine the worker crashes between completeJournal() and complete().
 *   - Journal says: COMPLETED (handler finished)
 *   - Event says: EXECUTING (complete() never ran)
 *   - Reaper reclaims → PENDING
 *   - Next worker acquires → checks dedup → sees COMPLETED journal
 *   - Skips handler → calls complete() directly
 *   → RESULT: exactly-once execution despite crash.
 *
 *   If we did it in reverse (event before journal) and crashed:
 *   - Event says: EXECUTED (complete() ran)
 *   - Journal says: STARTED (never updated)
 *   - This is fine too — EXECUTED events can't be re-acquired.
 *
 *   But if we crashed before complete() but after handler, with the
 *   event-before-journal ordering, the journal would be STARTED and
 *   the event EXECUTING. Next worker sees STARTED journal → ambiguous.
 *   With the journal-before-event ordering, the journal is COMPLETED
 *   and the event is EXECUTING. Next worker sees COMPLETED → dedup.
 *   The journal-before-event ordering is strictly better.
 *
 * The SKIPPED status:
 *   Returned when the dedup check finds a COMPLETED journal entry for
 *   this idempotency key. The handler is NOT executed. complete() IS
 *   called to ensure the event transitions to EXECUTED.
 */
export async function executeEvent(
  claim: ClaimResult,
  handler: PayloadHandler,
  executionTimeoutMs: number = env.LEASE_DURATION_MS * 2
): Promise<ExecutionResult> {
  const { eventId, payload, idempotencyKey } = claim;
  const workerId = env.WORKER_ID;
  const heartbeatIntervalMs = Math.floor(env.LEASE_DURATION_MS / 2);

  // ─── Step 0: Dedup check ─────────────────────────────────────────
  // Before any work, check if this idempotency key has already been
  // processed to completion. If so, skip the handler entirely.
  if (idempotencyKey) {
    const alreadyCompleted = await isIdempotencyKeyCompleted(idempotencyKey);

    if (alreadyCompleted) {
      logger.info(
        { eventId, idempotencyKey },
        "Idempotency key already completed — skipping handler"
      );

      // Still call complete() to transition event to EXECUTED
      // in case it's still EXECUTING (crash recovery scenario).
      await complete(eventId, workerId);

      return { status: "SKIPPED" };
    }
  }

  // ─── Step 1: Journal start ──────────────────────────────────────
  // Record "I intend to execute this event." BEFORE beginExecution so
  // that the forensic record exists even if beginExecution fails.
  const journal = await startJournal(eventId, workerId, idempotencyKey);

  if (!journal) {
    logger.error(
      { eventId, workerId },
      "Journal start failed — cannot proceed"
    );
    return { status: "ABORTED", reason: "Journal start failed" };
  }

  // ─── Step 2: beginExecution ─────────────────────────────────────
  const began = await beginExecution(eventId, workerId);
  if (!began) {
    logger.error(
      { eventId, workerId },
      "beginExecution failed — lease already lost"
    );
    // Journal stays STARTED — forensic evidence of abandoned attempt.
    return { status: "ABORTED", reason: "beginExecution failed" };
  }

  // ─── Step 3: Heartbeat + handler ────────────────────────────────
  const heartbeatCtrl = createHeartbeatController(
    eventId,
    workerId,
    heartbeatIntervalMs
  );
  heartbeatCtrl.start();

  let outcome: "OK" | "TIMEOUT" | "ABORTED";
  let handlerError: Error | undefined;

  try {
    outcome = await raceExecution(
      () => handler(payload),
      executionTimeoutMs,
      heartbeatCtrl.signal
    );
  } catch (err) {
    outcome = "TIMEOUT";
    handlerError = err instanceof Error ? err : new Error(String(err));
  }

  // ─── Step 4: Stop heartbeat BEFORE touching DB ──────────────────
  heartbeatCtrl.stop();

  // ─── Step 5: Journal + event status ────────────────────────────
  // CRITICAL ORDERING: journal first, then event status.
  // See doc comment above for why.

  if (outcome === "OK") {
    // 5. Atomically journal COMPLETED + event EXECUTED
    const result = await completeExecution(eventId, workerId, journal.id);
    if (!result.eventCompleted) {
      logger.warn(
        { eventId, workerId },
        "Handler completed but lease lost before complete()"
      );
      return { status: "ABORTED", reason: "Lease lost before complete" };
    }

    return { status: "EXECUTED" };
  }

  if (outcome === "TIMEOUT") {
    const errMsg = handlerError?.message ?? "Execution timed out";
    logger.warn({ eventId, workerId, timeoutMs: executionTimeoutMs }, errMsg);

    // 5a. Journal → FAILED
    await failJournal(journal.id, errMsg);

    // 5b. Event → FAILED
    const didFail = await fail(eventId, workerId, errMsg);
    if (!didFail) {
      return { status: "ABORTED", reason: "Lease lost before fail" };
    }
    return { status: "FAILED", error: errMsg };
  }

  // outcome === "ABORTED"
  // Journal stays STARTED — forensic evidence of the interrupted attempt.
  logger.warn(
    { eventId, workerId },
    "Execution aborted — lease lost mid-execution"
  );
  return { status: "ABORTED", reason: "Lease lost mid-execution" };
}
