import type { EventStatus } from "../db/schema.js";
import { ALLOWED_TRANSITIONS } from "./types.js";

/**
 * Pure function: can we move from `current` to `next`?
 *
 * This is a ***distributed*** state machine.
 * In a distributed system the "current" state is always stale by the time
 * you read it. The DB row may have moved on. That's why the *real* check
 * happens inside the SQL UPDATE ... WHERE status = :expected.
 *
 * This function exists to fail fast on programmer errors
 * (e.g. claiming an already-executed event) before we burn a DB round-trip.
 */
export function canTransition(
  current: EventStatus,
  next: EventStatus
): boolean {
  return ALLOWED_TRANSITIONS[current]?.has(next) ?? false;
}

/**
 * Validate or throw.
 * Used at the application boundary for early rejection.
 */
export function assertTransition(
  current: EventStatus,
  next: EventStatus
): void {
  if (!canTransition(current, next)) {
    throw new Error(
      `Invalid state transition: ${current} → ${next}. ` +
        `Allowed from ${current}: [${[...(ALLOWED_TRANSITIONS[current] ?? [])].join(", ")}]`
    );
  }
}
