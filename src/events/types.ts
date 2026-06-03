import type { EventStatus } from "../db/schema.js";

/**
 * Every transition must carry a reason.
 * This enables audit trails and crash forensics.
 */
export interface EventTransition {
  from: EventStatus;
  to: EventStatus;
  at: Date;
  by: string;
  reason: string;
}

/**
 * Valid state transitions.
 * Maps current status → set of allowed next statuses.
 */
export const ALLOWED_TRANSITIONS: Record<EventStatus, ReadonlySet<EventStatus>> =
  {
    PENDING: new Set(["CLAIMED"]),
    CLAIMED: new Set(["EXECUTING", "PENDING"]),
    EXECUTING: new Set(["EXECUTED", "FAILED", "PENDING"]),
    EXECUTED: new Set(),
    FAILED: new Set(["PENDING"]),
  };
