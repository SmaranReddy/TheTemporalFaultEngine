import { logger } from "../logger/index.js";

/**
 * ─── Temporary Deterministic Handler ──────────────────────────────
 *
 * Simulates internal work for Phase 2 testing.
 * This handler:
 *   1. Logs the payload
 *   2. Sleeps for a configurable delay
 *   3. Logs completion
 *
 * We avoid real external side effects for now. The goal is to validate
 * the scheduler-domain exactly-once semantics first.
 *
 * In Phase 3, this will be replaced by a configurable handler registry
 * that maps event types to real application handlers.
 *
 * For interview testing:
 *   - Set SIMULATED_WORK_DELAY_MS=0 to test fast-path execution
 *   - Set SIMULATED_WORK_DELAY_MS=45000 to trigger timeout
 *   - The handler logs each phase for observability
 */
const SIMULATED_WORK_DELAY_MS = parseInt(
  process.env.SIMULATED_WORK_DELAY_MS ?? "1000",
  10
);

export async function simulatedHandler(payload: string): Promise<void> {
  const { eventId } = JSON.parse(payload);

  logger.info(
    { eventId, delayMs: SIMULATED_WORK_DELAY_MS },
    "Handler started — simulating work"
  );

  await sleep(SIMULATED_WORK_DELAY_MS);

  logger.info({ eventId }, "Handler completed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
