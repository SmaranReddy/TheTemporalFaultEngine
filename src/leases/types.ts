/**
 * Result of a successful claim.
 * Returns enough context for the worker to execute without a follow-up query.
 */
export interface ClaimResult {
  eventId: string;
  payload: string;
  scheduledAt: Date;
  leaseExpiresAt: Date;
  attemptCount: number;
}
