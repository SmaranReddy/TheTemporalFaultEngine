/**
 * ─── Execution Timeout Wrapper ────────────────────────────────────
 *
 * Races the handler against:
 *   1. A hard timeout (executionTimeMs)
 *   2. An abort signal (lease loss detected by heartbeat)
 *
 * Resource cleanup:
 *   The setTimeout is cleared in the `finally` block after the race
 *   settles. The AbortSignal listener uses `{ once: true }` which
 *   auto-removes after firing. If the signal never fires, the listener
 *   lives until the signal is GC'd (when the heartbeat controller is
 *   garbage collected after execution completes). This is acceptable.
 *
 * Orphaned handler:
 *   If the timeout or abort wins, the handler Promise is abandoned.
 *   We CANNOT cancel an in-flight Promise in JavaScript. The handler
 *   continues running — but we've already moved on. This is acceptable
 *   because:
 *   - The event's status is EXECUTING (or will be reclaimed by reaper)
 *   - The next execution must be idempotent anyway
 *   - The abandoned handler can't affect the DB (its lease is gone)
 *
 * The race winner determines the result:
 *   - handler wins → execution succeeded
 *   - timeout wins → we call fail() with timeout error
 *   - abort wins   → we don't call complete/fail (lease already gone)
 */
export async function raceExecution(
  handler: () => Promise<void>,
  executionTimeoutMs: number,
  abortSignal: AbortSignal
): Promise<"OK" | "TIMEOUT" | "ABORTED"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      handler().then(() => "OK" as const),
      new Promise<"TIMEOUT">((resolve) => {
        timeoutId = setTimeout(() => resolve("TIMEOUT"), executionTimeoutMs);
      }),
      new Promise<"ABORTED">((resolve) => {
        if (abortSignal.aborted) {
          resolve("ABORTED");
          return;
        }
        abortSignal.addEventListener("abort", () => resolve("ABORTED"), {
          once: true,
        });
      }),
    ]);

    return result;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
