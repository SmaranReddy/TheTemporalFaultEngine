import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  index,
  uniqueIndex,
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

/**
 * Execution journal statuses:
 *
 *   STARTED    → Worker began processing this idempotency key
 *   COMPLETED  → Handler finished, complete() was called
 *   FAILED     → Handler threw, fail() was called
 *
 * An orphaned STARTED row (no COMPLETED) indicates the ambiguity window:
 * the worker may have crashed after the handler but before complete().
 */
export const executionStatus = [
  "STARTED",
  "COMPLETED",
  "FAILED",
] as const;

export type ExecutionStatus = (typeof executionStatus)[number];

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    payload: text("payload").notNull(),

    /**
     * Producer-provided idempotency key.
     * If set, the execution layer guarantees at-most-one COMPLETED
     * journal entry for this key across the entire system.
     *
     * Partial unique index: only non-null values are checked.
     */
    idempotencyKey: text("idempotency_key"),

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

    lastExecutionAttemptAt: timestamp("last_execution_attempt_at", {
      withTimezone: true,
      precision: 3,
    }),

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
    /**
     * Partial unique index on idempotency_key.
     * Only non-null values are indexed, so multiple events can have
     * null keys without violating the constraint.
     */
    idxIdempotencyKey: uniqueIndex("idx_events_idempotency_key")
      .on(table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  })
);

/**
 * ─── event_executions ────────────────────────────────────────────
 *
 * Append-only journal of every execution attempt.
 *
 * Why an execution journal?
 *   The events table only shows the CURRENT state (EXECUTING, EXECUTED).
 *   It doesn't show past attempts. The journal reveals:
 *     - How many times was this event retried?
 *     - Which workers handled previous attempts?
 *     - How long did each attempt take?
 *     - Did a previous attempt crash mid-execution? (STARTED without COMPLETED)
 *
 * Forensic debugging:
 *   If an event is stuck in EXECUTING, check the journal for the
 *   most recent STARTED row. If it's older than LEASE_DURATION_MS,
 *   the worker holding the lease has crashed. The journal proves it.
 *
 * Unique constraint:
 *   Only one COMPLETED row per idempotency_key. Multiple STARTED rows
 *   are allowed (multiple attempts for the same event). This prevents
 *   the dedup race: if two workers try to process the same key, the
 *   second INSERT for COMPLETED status fails.
 */
export const eventExecutions = pgTable(
  "event_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),

    workerId: text("worker_id").notNull(),

    idempotencyKey: text("idempotency_key"),

    executionStatus: varchar("execution_status", { length: 16 })
      .$type<ExecutionStatus>()
      .notNull()
      .default("STARTED"),

    executionStartedAt: timestamp("execution_started_at", {
      withTimezone: true,
      precision: 3,
    })
      .notNull()
      .defaultNow(),

    executionCompletedAt: timestamp("execution_completed_at", {
      withTimezone: true,
      precision: 3,
    }),

    errorMessage: text("error_message"),
  },
  (table) => ({
    /**
     * Only one COMPLETED execution per idempotency key.
     * This is the dedup guarantee: once a key is COMPLETED, any
     * future attempt to execute the same key will fail this constraint.
     */
    idxCompletedIdempotencyKey: uniqueIndex(
      "idx_exec_completed_idempotency_key"
    )
      .on(table.idempotencyKey)
      .where(
        sql`execution_status = 'COMPLETED' AND idempotency_key IS NOT NULL`
      ),

    idxEventId: index("idx_exec_event_id").on(table.eventId),
    idxExecutionStatus: index("idx_exec_status").on(table.executionStatus),
  })
);


