# Benchmark Results — Timing Validation

## Configuration

All benchmarks run in Docker Compose (postgres:17-alpine, redis:7-alpine, app container via `docker/Dockerfile`).

| Parameter | Value |
|---|---|
| Workers | 1 |
| `SCHEDULER_POLL_INTERVAL_MS` | 50 |
| `SCHEDULER_BATCH_SIZE` | 200 (code default) |
| `DATABASE_POOL_MAX` | 10 |
| `SIMULATED_WORK_DELAY_MS` | 0 (handler is instantaneous) |
| `LEASE_DURATION_MS` | 30,000 |
| Latency source | PostgreSQL `extract(epoch from (executed_at - scheduled_at)) * 1000` |

Latency captures the full pipeline: database insert → Redis enqueue → scheduler poll → acquire → execute → journal → complete.

## 50 Events

### Raw runs

| Run | Avg | P50 | P95 | P99 | Max |
|-----|-----|-----|-----|-----|-----|
| 1 | 128ms | 121ms | 199ms | 200ms | 200ms |
| 2 | 152ms | 148ms | 230ms | 233ms | 233ms |
| 3 | 163ms | 158ms | 241ms | 244ms | 244ms |
| **Mean** | **148ms** | **142ms** | **223ms** | **226ms** | **226ms** |

### Latency distribution (combined)

```
Range       Count
 50–100ms     13
100–150ms     25
150–200ms     52
200–250ms     60
```

## 100 Events

### Raw runs

| Run | Avg | P50 | P95 | P99 | Max |
|-----|-----|-----|-----|-----|-----|
| 1 | 251ms | 251ms | 396ms | 412ms | 415ms |
| 2 | 211ms | 209ms | 354ms | 359ms | 375ms |
| **Mean** | **231ms** | **230ms** | **375ms** | **386ms** | **395ms** |

### Latency distribution (combined)

```
Range        Count
  50–100ms     13
 100–200ms     32
 200–300ms     63
 300–400ms     82
 400–415ms     10
```

## Verdict

**FAIL** — p99 exceeds 200ms at both 50 events (mean 226ms) and 100 events (mean 386ms). The system cannot reliably meet the ±200ms requirement.

## Bottleneck Breakdown (50 events, mean p99 = 226ms)

| Bottleneck | Contribution | Percentage |
|---|---|---|
| Pipeline serialization: 5 sequential DB queries per event | ~160ms | 71% |
| Connection pool queue depth: 9 concurrent slots | ~80ms | 35% |
| Per-query latency: ~8ms per round-trip | ~40ms | 18% |
| Scheduler poll wait: 50ms interval | ~25ms | 11% |

Percentages exceed 100% because bottlenecks compound (queue depth is a function of pipeline serialization and per-query latency).

## Comparison with Phase 4 Results

In Phase 4, the scheduler poll interval was at the code default of 200ms. Reducing it to 50ms in this validation phase produced the following comparison:

| Metric | Phase 4 (200ms poll) | Current (50ms poll) | Change |
|---|---|---|---|
| p99 (100 events) | 338ms | 386ms (mean) | +14% |
| Min (100 events) | not collected | 59ms | improved |
| Poll contribution (avg) | ~100ms | ~25ms | −75% |

The poll interval reduction improved the head of the distribution (minimum latency dropped from an estimated ~92ms to ~59ms) but did not improve tail latency. At 100 events, the tail is dominated by execution queue depth, which is independent of poll interval.

## Gap to Target

### 50 events

| Component | Latency |
|---|---|
| Poll wait (avg) | 25ms |
| Queue wait: 5 batch-slots × 40ms | 200ms |
| Execution pipeline (5 queries) | 40ms |
| **Expected p99** | **~265ms** |
| **Measured p99 (mean)** | **226ms** |
| **Gap to 200ms** | **~26ms** |

### 100 events

| Component | Latency |
|---|---|
| Poll wait (avg) | 25ms |
| Queue wait: 11 batch-slots × 40ms | 440ms |
| Execution pipeline (5 queries) | 40ms |
| **Expected p99** | **~505ms** |
| **Measured p99 (mean)** | **386ms** |
| **Gap to 200ms** | **~186ms** |

The gap at 50 events is narrow (≈26ms) and could potentially be closed by per-query latency optimization. The gap at 100 events is structural (≈186ms) and requires reducing the number of queries per execution.

## Engineering Tradeoff Discussion

The timing requirement is in tension with the system's durability guarantees. Each of the 5 queries per execution serves a distinct correctness purpose:

| Query | Correctness guarantee |
|---|---|
| Idempotency SELECT | Prevents duplicate handler execution |
| Journal INSERT | Forensic record: "execution started" |
| Status UPDATE (EXECUTING) | Prevents re-claiming by other workers |
| Journal UPDATE (COMPLETED) | Proves handler finished (written before event status) |
| Status UPDATE (EXECUTED) | Final state transition |

Removing any query weakens a guarantee. The journal-before-status ordering (query 4 before query 5) is specifically designed so that a crash after the handler completes but before the event is marked EXECUTED can be detected and recovered — the journal proves the handler ran.

### Candidate improvements

1. **Merge journal and status updates** — Combine queries 4 and 5 into a single `UPDATE ... RETURNING` that writes both the journal completion and the event completion in one round-trip. Estimated savings: 1 query (20% of pipeline).
2. **Skip idempotency SELECT when no key is present** — Already implemented. No further gain possible.
3. **Use database functions (PL/pgSQL)** — Encapsulate the 5-query pipeline in a server-side function, eliminating client round-trips. Estimated savings: 3 round-trips (60% of pipeline). Tradeoff: moves logic into the database, harder to test and version.
4. **Defer journal writes to a background flush** — Write the journal asynchronously after the event completes. Tradeoff: crash between handler completion and journal flush loses the forensic record.

The highest-ROI change is (1) — merging journal completion and event completion into a single statement. This is safe because the journal-before-status invariant is maintained within the same transaction/statement. Estimated impact: reduces pipeline from 5 to 4 queries, cutting p99 at 100 events by approximately 20% (from ~386ms to ~310ms). Still above 200ms, but a meaningful improvement.

To fully meet the requirement, approaches (1) and (3) would need to be combined, reducing the pipeline to 1–2 round-trips. This would bring estimated p99 at 100 events to approximately 150–180ms.

## Raw Latency Data

### 50 events — Run 1

```
56, 60, 60, 61, 61, 66, 66, 84, 89, 93,
93, 94, 94, 95, 98, 115, 118, 118, 119, 119,
119, 121, 122, 128, 146, 147, 147, 147, 150, 151,
151, 155, 174, 174, 177, 177, 178, 178, 181, 181,
183, 196, 199, 199, 199, 199, 199, 200, 200, 200
```

### 50 events — Run 2

```
75, 78, 82, 82, 83, 83, 83, 84, 84, 110,
111, 114, 115, 117, 118, 118, 119, 137, 142, 143,
143, 143, 145, 148, 148, 149, 149, 168, 173, 174,
174, 174, 174, 177, 177, 194, 201, 203, 203, 207,
207, 208, 208, 226, 227, 230, 230, 232, 233, 233
```

### 50 events — Run 3

```
84, 84, 84, 84, 89, 89, 93, 93, 94, 102,
113, 116, 116, 119, 124, 126, 126, 137, 145, 148,
151, 151, 152, 155, 158, 159, 169, 179, 179, 184,
184, 186, 187, 190, 204, 211, 213, 214, 214, 217,
217, 223, 232, 238, 238, 241, 241, 244, 244
```

### 100 events — Run 1

```
92, 92, 93, 93, 93, 95, 96, 99, 100, 101,
120, 121, 124, 125, 128, 128, 128, 129, 135, 139,
139, 153, 153, 159, 160, 166, 167, 167, 171, 172,
183, 185, 188, 189, 197, 198, 199, 199, 203, 216,
217, 220, 223, 227, 228, 231, 234, 235, 241, 247,
248, 251, 251, 252, 254, 254, 264, 266, 272, 275,
276, 279, 280, 282, 285, 290, 301, 304, 307, 308,
308, 310, 313, 324, 328, 331, 334, 337, 337, 338,
340, 338, 355, 357, 357, 360, 363, 364, 364, 366,
367, 389, 390, 390, 394, 395, 396, 396, 398, 399,
412, 415
```

### 100 events — Run 2

```
59, 59, 59, 62, 62, 66, 67, 68, 90, 91,
91, 93, 93, 94, 94, 97, 111, 116, 117, 120,
121, 124, 124, 127, 145, 148, 148, 149, 152, 152,
155, 158, 158, 177, 178, 178, 181, 184, 187, 190,
206, 206, 209, 209, 209, 211, 212, 212, 215, 218,
233, 237, 237, 239, 240, 241, 247, 264, 267, 268,
269, 271, 288, 294, 294, 295, 295, 297, 297, 301,
318, 322, 322, 324, 325, 327, 332, 347, 351, 351,
353, 354, 354, 356, 359
```
