import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  index,
} from "drizzle-orm/pg-core";

/**
 * Event lifecycle states:
 *
 *   PENDING    → Scheduled but not yet claimed by any worker
 *   CLAIMED    → A worker holds the lease and is about to execute
 *   EXECUTING  → The worker is actively executing (set just before work starts)
 *   EXECUTED   → Completed successfully
 *   FAILED     → Completed with an unrecoverable error (retries exhausted)
 *
 * Transitions:
 *   PENDING  ──[claim]──→ CLAIMED
 *   CLAIMED  ──[begin]──→ EXECUTING
 *   EXECUTING──[done]──→ EXECUTED
 *   EXECUTING──[fail]──→ FAILED
 *   CLAIMED  ──[reap]──→ PENDING   (lease expired before EXECUTING)
 *   EXECUTING──[reap]──→ PENDING   (lease expired, worker crashed)
 */
export const eventStatus = [
  "PENDING",
  "CLAIMED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
] as const;

export type EventStatus = (typeof eventStatus)[number];

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    payload: text("payload").notNull(),

    scheduledAt: timestamp("scheduled_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),

    status: varchar("status", { length: 16 })
      .$type<EventStatus>()
      .notNull()
      .default("PENDING"),

    claimedBy: text("claimed_by"),

    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3,
    }),

    executedAt: timestamp("executed_at", {
      withTimezone: true,
      precision: 3,
    }),

    attemptCount: integer("attempt_count").notNull().default(0),

    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    idxScheduledAt: index("idx_events_scheduled_at").on(table.scheduledAt),
    idxStatus: index("idx_events_status").on(table.status),
    idxLeaseExpiresAt: index("idx_events_lease_expires_at").on(
      table.leaseExpiresAt
    ),
    idxClaimedBy: index("idx_events_claimed_by").on(table.claimedBy),
  })
);
