# Query plans at volume

The API's three main reads, run as `EXPLAIN (ANALYZE, BUFFERS)` against a table of 7,349,463 rows (4.9 GB with its indexes). This is evidence for S1: list, detail and summary at p95 under 200 ms on a database of at least 5M rows. The plans show the reasons it is met, not only the timings.

## Setup

- **The customer:** the one with the most rows, `756ca152-…`: 1,598 rows in all, 732 of them in the window below. A typical customer has about 1,470 rows.
- **The window:** the last year, `fromDateTime=2025-10-28T00:00:00Z` to `toDateTime=2026-10-29T00:00:00Z`. The API clamps the end to now.
- **How they were captured:**
  - The API ran on the host with `DATABASE_QUERY_LOG_SQL=true` and `DATABASE_QUERY_LOG_PLAN=true`, so it logged each statement exactly as sent, with its plan.
  - Each request was sent twice, and the plan here is from the second. Its buffers are therefore cache hits, as they would be for a customer who is paging.
  - Postgres 18.4, in compose on a MacBook Pro (M1 Pro).
- **The table:** monthly partitions on `occurred_at`, 23 of them including the default partition. Each partition has the covering read index `(user_id, occurred_at DESC, transaction_id DESC) INCLUDE (…)`.

## The three plans

| Query | Request | Execution | Planning | Buffers |
| --- | --- | --- | --- | --- |
| [List](plans/list.sql) | first page, 50 rows, newest first | 0.26 ms | 1.1 ms | 110 hits |
| [Detail](plans/detail.sql) | one transaction by id | 0.29 ms | 1.1 ms | 117 hits |
| [Summary](plans/summary.sql) | twelve months, monthly buckets by category | 1.37 ms | 1.1 ms | 172 hits |

Each file holds the SQL exactly as the API sent it, with its plan below.

**List:**
- **Pruning:** the window prunes the table to the 13 partitions it overlaps, at planning time.
- **The scan:** under the `LIMIT 51`, each partition is an *Index Only Scan* on the read index, with 0 heap fetches. The newest partition alone held 51 rows, so the other 12 scans show "never executed": newest-first keyset paging stops as soon as the page is full.
- **What a later page costs:** the same, because the cursor adds a seek on `(occurred_at, transaction_id)` and the scan starts there.

**Detail:**
- **Every partition is probed:** the request names only the user and the transaction id, so no `occurred_at` can prune partitions. The plan is one index lookup in each of the 23 partitions, which is 0.29 ms at this size. It uses the primary key in the 19 partitions that hold rows. In the 4 empty ones (the oldest month, the two future months, and the default partition) it uses the read index.
- **The cost of that:** it grows with the number of partitions, not with the number of rows.

**Summary:**
- **The scan:** an *Index Only Scan* of the read index on each of the 13 partitions in the window. It reads the customer's 732 rows, groups them by month, category and currency, and sorts the 123 buckets.
- **Heap fetches:** there were 88, on pages written by the stream runs that autovacuum hadn't yet marked all-visible. Once it has, the scan reads the index alone.

## What the plans also show

- **The override joins aren't pruned:** they reach every partition of `user_transaction_overrides`, because the join is on `(transaction_id, occurred_at)` and nothing gives that table a window.
  - Those partitions are empty here, so each one costs a sequential scan of nothing.
  - With many overrides it becomes one index probe per partition per row, which is cheap but grows with the number of partitions.
- **Planning outweighs execution:** about 1.1 ms against 0.3–1.4 ms, because the planner looks at every partition. That's the price of monthly partitions with 18-month retention, and it stays flat as rows grow.

## The k6 run

The latency target itself is measured end to end by the load test. See [README.md](README.md).
