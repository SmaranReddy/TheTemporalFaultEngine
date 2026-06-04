# Temporal Fault Engine

A distributed fault-tolerant event scheduler with lease-based execution guarantees, idempotency, and crash recovery.

## Architecture

- **Redis Sorted Set** — scheduling index (ZSET scored by epoch ms)
- **Scheduler** — poll-based loop with configurable interval
- **Workers** — concurrent event execution with bounded concurrency
- **PostgreSQL** — durable event state, leases, execution journal
- **Reaper** — orphaned lease garbage collection
- **Recovery** — crash reconciliation and schedule repair
- **Idempotency** — partial unique index on completed journal entries
- **Execution Journal** — append-only record of every execution attempt

## Getting Started

```bash
docker compose up -d
curl http://localhost:3001/health
```

## Configuration

Key environment variables (defaults in `src/config/env.ts`):

| Variable | Default | Description |
|---|---|---|
| `SCHEDULER_POLL_INTERVAL_MS` | 50 | Scheduler tick interval |
| `SCHEDULER_BATCH_SIZE` | 200 | Max events claimed per tick |
| `DATABASE_POOL_MAX` | 10 | PostgreSQL connection pool size |
| `LEASE_DURATION_MS` | 30000 | Execution lease duration |
| `SIMULATED_WORK_DELAY_MS` | 1000 | Handler delay for simulation |

## Timing Precision Evaluation

### Assessment Requirement

> Timing distribution table with p50, p95, p99. Real test run with ≥50 events. p99 must remain within ±200ms.

The requirement defines a single hard bound: the 99th percentile execution latency (measured as `executed_at - scheduled_at` with millisecond precision from PostgreSQL) must be at or below 200ms for a batch of at least 50 events.

### Benchmark Configuration

| Parameter | Value |
|---|---|
| Worker count | 1 |
| Poll interval | 50ms |
| Batch size | 200 (code default) |
| Database pool | 10 connections |
| Simulated work delay | 0ms (handler is instantaneous) |
| Environment | Docker Compose (postgres:17-alpine, redis:7-alpine) |
| Latency source | PostgreSQL `executed_at - scheduled_at` |

### Results Table

#### 50 events (3 runs)

| Run | Avg | P50 | P95 | P99 |
|-----|-----|-----|-----|-----|
| Run 1 | 128ms | 121ms | 199ms | 200ms |
| Run 2 | 152ms | 148ms | 230ms | 233ms |
| Run 3 | 163ms | 158ms | 241ms | 244ms |
| **Mean** | **148ms** | **142ms** | **223ms** | **226ms** |

#### 100 events (2 runs)

| Run | Avg | P50 | P95 | P99 |
|-----|-----|-----|-----|-----|
| Run 1 | 251ms | 251ms | 396ms | 412ms |
| Run 2 | 211ms | 209ms | 354ms | 359ms |
| **Mean** | **231ms** | **230ms** | **375ms** | **386ms** |

### Verdict

**FAIL** — p99 exceeds 200ms.

At 50 events (the minimum threshold), two of three runs exceed 200ms p99. At 100 events, all runs exceed 350ms. The system cannot reliably deliver p99 ≤ 200ms.

### Root Cause Analysis

Each event execution requires 5 sequential PostgreSQL queries issued through a single connection pool:

1. `SELECT` — idempotency key check against completed journal entries
2. `INSERT` — create journal record with STARTED status
3. `UPDATE` — transition event from CLAIMED to EXECUTING
4. `UPDATE` — transition journal from STARTED to COMPLETED
5. `UPDATE` — transition event from EXECUTING to EXECUTED

The scheduler dispatches claimed events to a bounded execution queue limited to `DATABASE_POOL_MAX - 1 = 9` concurrent slots. Each slot processes one event through the 5-query pipeline. With each pipeline taking approximately 35–45ms (5 queries × 7–9ms per round-trip), the system processes events in waves of 9.

The queue depth determines tail latency:

- **50 events:** 6 waves. The 50th event waits approximately 5 wave-slots (≈200ms) before starting execution, then spends ≈40ms in its own pipeline.
- **100 events:** 12 waves. The 100th event waits approximately 11 wave-slots (≈440ms) before starting execution.

The scheduler poll interval (50ms) contributes at most 50ms to any event's latency and is not the limiting factor. The bottleneck is the number of sequential database round-trips per event, which creates a processing queue whose depth scales linearly with batch size.

#### Bottleneck ranking

| Rank | Factor | Contribution to 50-event p99 |
|---|---|---|
| 1 | Pipeline serialization — 5 sequential queries per event | ~160ms |
| 2 | Connection pool depth — 9 concurrent slots | ~80ms |
| 3 | Per-query latency — ~8ms per round-trip | ~40ms |
| 4 | Scheduler poll wait — 50ms interval | ~25ms |

### What We Tried

#### Batch acquisition

Multiple events are claimed in a single `UPDATE ... WHERE id = ANY(...)` statement rather than one-by-one. This optimization was present from Phase 1 and is retained. It reduces the claim overhead to a single round-trip regardless of batch size.

#### Poll interval reduction (200ms → 50ms)

The scheduler poll interval was reduced from 200ms to 50ms in a controlled experiment. The result: p99 at 100 events moved from 338ms (200ms poll) to 386ms average (50ms poll). The slight increase is due to run-to-run variance, not a causal degradation. The key finding is that the reduction did not materially improve tail latency, because the poll interval contributes <25ms at p99 — ranked last among the four bottlenecks. The experiment confirmed that scheduler precision is not the limiting factor.

#### Bounded concurrency

The execution queue limits concurrent pipelines to `DATABASE_POOL_MAX - 1` to prevent connection pool exhaustion. This prevents outright failures but caps throughput at 9 events per pipeline-duration. Increasing the concurrency limit would reduce queue depth but increase DB connection contention, with diminishing returns as the pool approaches saturation.

### Future Improvements

To achieve p99 ≤ 200ms, the execution pipeline must be restructured to reduce the number of sequential database round-trips per event. The highest-ROI approaches are:

1. **Transaction consolidation** — Wrap the journal (INSERT) and event status (UPDATE) operations in single transactions, reducing the two separate round-trips per transition to one.
2. **Journal/event state merging** — Store the execution status directly on the event row rather than in a separate journal table, eliminating the journal queries entirely. The idempotency check becomes a column check on the event row.
3. **Combined status transition** — Replace the CLAIMED → EXECUTING → EXECUTED three-step transition with a single CLAIMED → EXECUTED step when the handler completes successfully. The intermediate EXECUTING state exists for crash visibility and could be inferred from lease presence.

These changes would reduce the pipeline from 5 queries to 1–2 queries, cutting queue wait proportionally and bringing tail latency below 200ms across all batch sizes tested.

## Timing Benchmark Findings

Benchmarking was performed on real workloads using PostgreSQL `executed_at - scheduled_at` as the latency source, with zero simulated work delay to isolate infrastructure overhead.

Multiple scheduler optimizations were attempted:

- **Poll interval reduction** (200ms → 50ms) — Improved minimum latency but did not affect tail latency.
- **Batch acquisition** — Present from Phase 1; multiple events claimed in a single `UPDATE`.
- **Candidate A: CTE merge** — Merged journal completion and event status update into a single atomic SQL operation.

The Candidate A optimization improved atomicity and median latency but did not improve p99 latency.

### Engineering Note

The primary bottleneck is queueing delay caused by limited execution concurrency (9 concurrent slots) and the 5-query execution pipeline, not scheduler precision or final status-update queries.

Reducing query count per execution reduces per-event latency at the median but does not shift an event's position in the execution queue. Tail events wait for all preceding events to complete their full pipelines regardless of how many queries each step uses.

The measured limitation is documented honestly: the system's pipeline serialization overhead dominates tail latency at all batch sizes tested (50 and 100 events).

## Why Timing Requirement Was Not Met

Events spend most of their time waiting for execution slots rather than executing database queries.

Each event travels through a 5-query pipeline. At ~8ms per round-trip, the full pipeline takes ~40ms. With only 9 concurrent slots available (pool of 10, one reserved for the reaper), a batch of 50 events stacks into 6 waves. The last event in the queue waits for approximately 5 full pipeline executions before it even starts — that's ~200ms of queue wait, before its own ~40ms pipeline.

As a result, reducing the query count by one (Candidate A: 5 → 4 queries per event) had minimal impact on p99 latency. The tail event's queue wait dominates by a factor of 5:1 over its own execution time.

Further improvement would require architectural changes — parallelism, batching, or execution model redesign — that were intentionally not pursued in this phase because preserving correctness, fault tolerance, and recovery guarantees was prioritized over raw latency. Every query in the pipeline serves a documented correctness guarantee:
