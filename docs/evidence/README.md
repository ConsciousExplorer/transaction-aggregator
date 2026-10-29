# Evidence

Measurements behind the service targets, taken on 2026-10-28 against the full stack in compose. The machine was a MacBook Pro (M1 Pro, 16 GB), with Docker in a 4-CPU, 7.7 GB VM.

| Target | Measure | Result | Evidence |
| --- | --- | --- | --- |
| S1 | API latency, p95 under 200 ms at 50 req/s on at least 5M rows | **Met:** p95 17.6 ms at 54.5 req/s on 7,349,463 rows, 0 failures | k6 report [`load-20261028-161600.html`](../../loadtests/results/load-20261028-161600.html) and [query-plans.md](query-plans.md) |
| S2 | Ingest lag, p95 under 5 s at 250 messages a second | **Met:** p95 1.74 s | [write-throughput.md](write-throughput.md) |
| S6 | Write throughput, measured | A backlog drains at about 4,200 rows a second (peak 7,300), and a live stream holds about 4,000 a second | [write-throughput.md](write-throughput.md) |

S3 and S4 (duplicates and poison messages) are covered by the consumer's integration tests in CI, not measured here. For S5 (under 1% uncategorised), the same database had 0 of its 7,349,463 rows on the fallback category: every row matched a rule.

## S1: the load test

`make load` ran the `load` profile: randomised portal sessions arriving at 10 a second for 10 minutes, about 5.5 requests each, 3% of them writes. `loadtests/README.md` explains the sessions.

- **Rows at the start:** 7,349,463, counted at 14:15:49 UTC. The run started a few seconds later.
- **Requests:** 33,516, at 54.5 a second.
- **Overall latency:** p95 17.6 ms and p99 24.9 ms, with 0 failed requests. All 33,515 checks passed, the writes and their read-backs included.
- **Slowest route at p95:** the summary, at 21.1 ms. The routes range from 9.0 ms to 21.1 ms.

[query-plans.md](query-plans.md) shows why it's fast at this size: each read is an index range over the customer's own rows, in the partitions its date window covers.

## How to repeat it

1. `make clean`, then `make up-all`. Wait for the producers to exit.
2. `make produce-load-data`. Wait until the consumers' lag is 0 (about 20 minutes). The table then holds 5,115,001 rows.
3. **Stream steps:** `make produce-stream` with the per-source rates scaled up. For 250 a second: `CARD_RATE=160 EFT_RATE=51 DEBIT_ORDER_RATE=26 INTERNAL_TRANSFER_RATE=13 make produce-stream`. Read lag on the Grafana Consumers dashboard.
4. **Query plans:** run the API on the host with `DATABASE_QUERY_LOG_SQL=true` and `DATABASE_QUERY_LOG_PLAN=true` (see `database/query-plans/`).
5. `make load`.

Each run makes a different dataset (a fresh seed), so expect the same shape, not identical numbers.
