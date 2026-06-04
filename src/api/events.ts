import { desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, healthCheck as dbHealthCheck } from "../db/index.js";
import { events, eventExecutions, eventStatus } from "../db/schema.js";
import type { EventStatus } from "../db/schema.js";
import { healthCheck as redisHealthCheck } from "../redis/index.js";
import { addToScheduleWithRetry } from "../scheduler/index.js";
import { broadcast } from "./realtime.js";

const insertEventSchema = z.object({
  payload: z.unknown(),
  scheduledAt: z.coerce.date().default(() => new Date()),
  idempotencyKey: z.string().min(1).optional(),
});

const benchmarkSchema = z.object({
  count: z.coerce.number().int().min(1).max(1000).default(100),
  delayMs: z.coerce.number().int().min(0).max(3_600_000).default(0),
  prefix: z.string().min(1).max(80).default("bench"),
});

export interface InsertedEvent {
  id: string;
  payload: string;
  scheduledAt: Date;
  status: EventStatus;
  idempotencyKey: string | null;
  createdAt: Date;
}

export async function insertEvent(input: unknown): Promise<InsertedEvent> {
  const parsed = insertEventSchema.parse(input);
  const payload =
    typeof parsed.payload === "string"
      ? parsed.payload
      : JSON.stringify(parsed.payload);

  const [row] = await db
    .insert(events)
    .values({
      payload,
      scheduledAt: parsed.scheduledAt,
      idempotencyKey: parsed.idempotencyKey,
    })
    .returning({
      id: events.id,
      payload: events.payload,
      scheduledAt: events.scheduledAt,
      status: events.status,
      idempotencyKey: events.idempotencyKey,
      createdAt: events.createdAt,
    });

  if (!row) {
    throw new Error("Event insert returned no row");
  }

  await addToScheduleWithRetry(row.id, row.scheduledAt);
  broadcast({
    type: "event.created",
    eventId: row.id,
    status: row.status,
    at: new Date().toISOString(),
  });

  return row;
}

export async function listEvents(query: URLSearchParams): Promise<unknown[]> {
  const status = query.get("status");
  const limit = clampNumber(query.get("limit"), 1, 200, 50);

  const filters =
    status && isEventStatus(status) ? eq(events.status, status) : undefined;

  const rows = await db
    .select({
      id: events.id,
      payload: events.payload,
      idempotencyKey: events.idempotencyKey,
      scheduledAt: events.scheduledAt,
      status: events.status,
      claimedBy: events.claimedBy,
      leaseExpiresAt: events.leaseExpiresAt,
      executedAt: events.executedAt,
      attemptCount: events.attemptCount,
      lastError: events.lastError,
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
    })
    .from(events)
    .where(filters)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    payload: parsePayload(row.payload),
  }));
}

export async function getMetrics(): Promise<unknown> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const statusRows = await db
    .select({
      status: events.status,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .groupBy(events.status);

  const recentRows = await db
    .select({
      status: events.status,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(gte(events.createdAt, oneHourAgo))
    .groupBy(events.status);

  const [executionRow] = await db
    .select({
      started: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where execution_status = 'COMPLETED')::int`,
      failed: sql<number>`count(*) filter (where execution_status = 'FAILED')::int`,
      avgDurationMs: sql<number | null>`avg(extract(epoch from (execution_completed_at - execution_started_at)) * 1000)::float`,
    })
    .from(eventExecutions);

  const [lagRow] = await db
    .select({
      duePending: sql<number>`count(*) filter (where status = 'PENDING' and scheduled_at <= now())::int`,
      maxLagMs: sql<number | null>`max(extract(epoch from (now() - scheduled_at)) * 1000) filter (where status = 'PENDING' and scheduled_at <= now())::float`,
    })
    .from(events);

  const dbHealthy = await dbHealthCheck();
  const redisHealthy = await redisHealthCheck();

  return {
    generatedAt: now.toISOString(),
    health: {
      database: dbHealthy ? "healthy" : "unhealthy",
      redis: redisHealthy ? "healthy" : "unhealthy",
    },
    events: {
      byStatus: statusCounts(statusRows),
      recentByStatus: statusCounts(recentRows),
      duePending: lagRow?.duePending ?? 0,
      maxSchedulerLagMs: Math.round(lagRow?.maxLagMs ?? 0),
    },
    executions: {
      started: executionRow?.started ?? 0,
      completed: executionRow?.completed ?? 0,
      failed: executionRow?.failed ?? 0,
      avgDurationMs: Math.round(executionRow?.avgDurationMs ?? 0),
    },
  };
}

export async function getPrometheusMetrics(): Promise<string> {
  const metrics = await getMetrics();
  const data = metrics as {
    health: { database: string; redis: string };
    events: {
      byStatus: Record<EventStatus, number>;
      duePending: number;
      maxSchedulerLagMs: number;
    };
    executions: {
      started: number;
      completed: number;
      failed: number;
      avgDurationMs: number;
    };
  };

  const lines = [
    "# HELP tfe_events_total Events by lifecycle status.",
    "# TYPE tfe_events_total gauge",
    ...eventStatus.map(
      (status) => `tfe_events_total{status="${status}"} ${data.events.byStatus[status]}`
    ),
    "# HELP tfe_due_pending_events Pending events whose schedule time has passed.",
    "# TYPE tfe_due_pending_events gauge",
    `tfe_due_pending_events ${data.events.duePending}`,
    "# HELP tfe_scheduler_max_lag_ms Maximum lag for due pending events.",
    "# TYPE tfe_scheduler_max_lag_ms gauge",
    `tfe_scheduler_max_lag_ms ${data.events.maxSchedulerLagMs}`,
    "# HELP tfe_execution_attempts_total Execution journal attempts.",
    "# TYPE tfe_execution_attempts_total gauge",
    `tfe_execution_attempts_total{status="STARTED"} ${data.executions.started}`,
    `tfe_execution_attempts_total{status="COMPLETED"} ${data.executions.completed}`,
    `tfe_execution_attempts_total{status="FAILED"} ${data.executions.failed}`,
    "# HELP tfe_execution_avg_duration_ms Average completed/failed execution duration.",
    "# TYPE tfe_execution_avg_duration_ms gauge",
    `tfe_execution_avg_duration_ms ${data.executions.avgDurationMs}`,
    "# HELP tfe_dependency_healthy Dependency health as 1 healthy, 0 unhealthy.",
    "# TYPE tfe_dependency_healthy gauge",
    `tfe_dependency_healthy{name="database"} ${data.health.database === "healthy" ? 1 : 0}`,
    `tfe_dependency_healthy{name="redis"} ${data.health.redis === "healthy" ? 1 : 0}`,
  ];

  return `${lines.join("\n")}\n`;
}

export async function runBenchmark(input: unknown): Promise<unknown> {
  const parsed = benchmarkSchema.parse(input);
  const startedAt = performance.now();
  const scheduledAt = new Date(Date.now() + parsed.delayMs);
  const runId = Date.now();
  const values = Array.from({ length: parsed.count }, (_, index) => ({
    payload: JSON.stringify({
      eventId: `${parsed.prefix}-${runId}-${index}`,
      benchmark: true,
      ordinal: index + 1,
    }),
    scheduledAt,
    idempotencyKey: `${parsed.prefix}-${runId}-${index}`,
  }));

  const rows = await db
    .insert(events)
    .values(values)
    .returning({ id: events.id, scheduledAt: events.scheduledAt });

  await Promise.all(
    rows.map((row) => addToScheduleWithRetry(row.id, row.scheduledAt))
  );

  const durationMs = Math.round(performance.now() - startedAt);
  broadcast({
    type: "event.created",
    eventId: "benchmark",
    status: "PENDING",
    at: new Date().toISOString(),
  });

  return {
    inserted: rows.length,
    durationMs,
    insertsPerSecond: Math.round((rows.length / Math.max(durationMs, 1)) * 1000),
    scheduledAt: scheduledAt.toISOString(),
  };
}

function statusCounts(
  rows: Array<{ status: EventStatus; count: number }>
): Record<EventStatus, number> {
  return Object.fromEntries(
    eventStatus.map((status) => [
      status,
      rows.find((row) => row.status === status)?.count ?? 0,
    ])
  ) as Record<EventStatus, number>;
}

function isEventStatus(status: string): status is EventStatus {
  return eventStatus.includes(status as EventStatus);
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function clampNumber(
  value: string | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function getBenchmarkMetrics(): Promise<unknown> {
  const [latencyRow] = await db
    .select({
      avg: sql<number | null>`avg(extract(epoch from (${events.executedAt} - ${events.scheduledAt})) * 1000)::float`,
      p50: sql<number | null>`percentile_cont(0.50) within group (order by extract(epoch from (${events.executedAt} - ${events.scheduledAt})) * 1000)::float`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by extract(epoch from (${events.executedAt} - ${events.scheduledAt})) * 1000)::float`,
      p99: sql<number | null>`percentile_cont(0.99) within group (order by extract(epoch from (${events.executedAt} - ${events.scheduledAt})) * 1000)::float`,
      max: sql<number | null>`max(extract(epoch from (${events.executedAt} - ${events.scheduledAt})) * 1000)::float`,
    })
    .from(events)
    .where(
      sql`${events.status} = 'EXECUTED' AND ${events.payload} LIKE '%"benchmark":true%'`
    );

  const [countsRow] = await db
    .select({
      executed: sql<number>`count(*) filter (where ${events.status} = 'EXECUTED')::int`,
      failed: sql<number>`count(*) filter (where ${events.status} = 'FAILED')::int`,
    })
    .from(events)
    .where(sql`${events.payload} LIKE '%"benchmark":true%'`);

  const [attemptsRow] = await db
    .select({
      attempts: sql<number>`count(*)::int`,
    })
    .from(eventExecutions)
    .innerJoin(events, eq(eventExecutions.eventId, events.id))
    .where(sql`${events.payload} LIKE '%"benchmark":true%'`);

  const workerDistRows = await db
    .select({
      worker: eventExecutions.workerId,
      count: sql<number>`count(*)::int`,
    })
    .from(eventExecutions)
    .innerJoin(events, eq(eventExecutions.eventId, events.id))
    .where(sql`${events.payload} LIKE '%"benchmark":true%'`)
    .groupBy(eventExecutions.workerId)
    .orderBy(sql`count(*) DESC`);

  return {
    latency: {
      avg: latencyRow?.avg ? Math.round(latencyRow.avg) : 0,
      p50: latencyRow?.p50 ? Math.round(latencyRow.p50) : 0,
      p95: latencyRow?.p95 ? Math.round(latencyRow.p95) : 0,
      p99: latencyRow?.p99 ? Math.round(latencyRow.p99) : 0,
      max: latencyRow?.max ? Math.round(latencyRow.max) : 0,
    },
    counts: {
      executed: countsRow?.executed ?? 0,
      failed: countsRow?.failed ?? 0,
      attempts: attemptsRow?.attempts ?? 0,
    },
    workerDistribution: workerDistRows ?? [],
  };
}
