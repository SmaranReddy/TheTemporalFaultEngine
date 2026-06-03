import { db } from "../db/index.js";
import { eventExecutions } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../logger/index.js";

export interface JournalEntry {
  id: string;
}

/**
 * ─── isIdempotencyKeyCompleted ────────────────────────────────────
 *
 * Dedup check: has this idempotency_key already been processed to
 * completion anywhere in the system?
 *
 * Uses the partial unique index on event_executions:
 *   (idempotency_key) WHERE execution_status = 'COMPLETED'
 *
 * If this query returns a row, the key has been COMPLETED. The
 * executor should skip the handler and safely mark the event EXECUTED.
 *
 * Race condition: what if two events have the same idempotency key
 * and two workers try to execute them simultaneously?
 *
 *   Worker A checks → no COMPLETED row
 *   Worker B checks → no COMPLETED row
 *   Both insert STARTED rows (allowed — no unique constraint on STARTED)
 *   Both begin execution
 *   Both try to complete
 *   One succeeds (COMPLETED), the other fails (unique constraint)
 *
 * This is acceptable! The second completion fails with a unique
 * constraint violation, which the executor catches and treats as
 * "already processed — skip."
 *
 * But this wastes work (two handlers run). To minimize it:
 *   The lease system prevents two workers from holding the lease for
 *   the same event simultaneously. Different events with the same key
 *   can race, but that's a producer error (duplicate idempotency keys).
 */
export async function isIdempotencyKeyCompleted(
  idempotencyKey: string | null
): Promise<boolean> {
  if (!idempotencyKey) return false;

  const [row] = await db
    .select({ id: eventExecutions.id })
    .from(eventExecutions)
    .where(
      and(
        eq(eventExecutions.idempotencyKey, idempotencyKey),
        eq(eventExecutions.executionStatus, "COMPLETED")
      )
    )
    .limit(1);

  return !!row;
}

/**
 * ─── startJournal ─────────────────────────────────────────────────
 *
 * Records the START of an execution attempt.
 * Called BEFORE the handler runs, AFTER the dedup check.
 *
 * This INSERT creates a forensic record: "worker X started processing
 * event Y at time Z with idempotency key K."
 *
 * If the worker crashes after this INSERT but before completeJournal(),
 * the row remains STARTED forever. This is an ORPHANED row — it proves
 * the ambiguity window was entered.
 *
 * The completeJournal() call later updates this row to COMPLETED.
 */
export async function startJournal(
  eventId: string,
  workerId: string,
  idempotencyKey: string | null
): Promise<JournalEntry | null> {
  try {
    const [row] = await db
      .insert(eventExecutions)
      .values({
        eventId,
        workerId,
        idempotencyKey,
        executionStatus: "STARTED",
      })
      .returning({ id: eventExecutions.id });

    if (!row) {
      logger.error({ eventId, workerId }, "Journal start returned no row");
      return null;
    }

    logger.debug({ eventId, journalId: row.id }, "Journal entry created");

    return { id: row.id };
  } catch (err) {
    logger.error({ eventId, workerId, err }, "Journal start failed");
    return null;
  }
}

/**
 * ─── completeJournal ──────────────────────────────────────────────
 *
 * Marks a journal entry as COMPLETED.
 * Called AFTER the handler completes successfully, BEFORE complete().
 *
 * This is the critical ordering:
 *   1. completeJournal() → marks execution as COMPLETED
 *   2. complete() → marks event as EXECUTED
 *
 * If the worker crashes between these two calls:
 *   - The journal says COMPLETED (the handler definitely finished)
 *   - The event says EXECUTING (complete() wasn't called)
 *   - Reaper reclaims the event
 *   - Next worker checks dedup: "Has this idempotency_key been COMPLETED?"
 *   - YES — skip the handler, just call complete()
 *   - Result: exactly-once execution
 *
 * This is the key insight: the journal's COMPLETED status is set BEFORE
 * the event's EXECUTED status. This creates a one-way door:
 *   journal COMPLETED → handler definitely finished
 *   journal STARTED → handler may or may not have finished (ambiguous)
 *
 * The unique constraint on COMPLETED + idempotency_key ensures that
 * even if the event is re-queued, the dedup check catches it.
 */
export async function completeJournal(journalId: string): Promise<boolean> {
  try {
    const [row] = await db
      .update(eventExecutions)
      .set({
        executionStatus: "COMPLETED",
        executionCompletedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(eventExecutions.id, journalId),
          eq(eventExecutions.executionStatus, "STARTED")
        )
      )
      .returning({ id: eventExecutions.id });

    if (!row) {
      logger.warn(
        { journalId },
        "Journal complete failed — entry not found or already completed"
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ journalId, err }, "Journal complete threw");
    return false;
  }
}

/**
 * ─── failJournal ──────────────────────────────────────────────────
 *
 * Marks a journal entry as FAILED.
 * Called AFTER the handler throws, BEFORE fail().
 */
export async function failJournal(
  journalId: string,
  errorMessage: string
): Promise<boolean> {
  try {
    const [row] = await db
      .update(eventExecutions)
      .set({
        executionStatus: "FAILED",
        executionCompletedAt: sql`NOW()`,
        errorMessage,
      })
      .where(
        and(
          eq(eventExecutions.id, journalId),
          eq(eventExecutions.executionStatus, "STARTED")
        )
      )
      .returning({ id: eventExecutions.id });

    if (!row) {
      logger.warn(
        { journalId },
        "Journal fail failed — entry not found or already completed"
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ journalId, err }, "Journal fail threw");
    return false;
  }
}
