# Write throughput and ingest lag

Measured on 2026-10-28, on one laptop, against the whole stack running in compose. This page is the evidence for two service targets:

- **S2, ingest lag:** p95 under 5 s at 250 messages a second.
- **S6, write throughput:** measured and recorded, with no target set in advance.

## Results

- **S2 is met.** At 250 messages a second, ingest lag p95 was 1.7 s.
- **Backlog:** the four consumers stored a 4.9M-record backlog at about 4,200 rows a second on average, and up to 7,300 a second at their peak.
- **Live stream:** a steady stream holds up to about 4,000 messages a second, with p95 lag under 1 s. At 5,000 a second, the card consumer falls behind and lag grows.

## Setup

- **Machine:** MacBook Pro, Apple M1 Pro, 16 GB. Docker runs in Rancher Desktop's VM with 4 CPUs and 7.7 GB. Kafka, Postgres, the four consumers, the producers, the API and the observability stack all share it.
- **Database:**
  - The backlog run started from the 240,000 rows `make up` stores, and ended at 5,115,001 rows.
  - The stream runs added more. The table held 7,349,463 rows (4.9 GB with its indexes) by the end.
- **Consumer settings:** the defaults: batches of 100 records or 2 s linger, a 1 MiB fetch cap, one consumer per source reading all 12 partitions of its topic.
- **Where the figures come from:**
  - Row counts are `count(*)` in Postgres.
  - Everything else comes from the consumers' Prometheus metrics: `rows_inserted_total`, `batch_flush_duration_seconds`, `insert_duration_seconds` and `ingest_lag_seconds`.
  - Rates are 1-minute rates. Percentiles are taken over the whole window from the histograms.
  - Lag percentiles are interpolated within the histogram's buckets: 0.1, 0.5, 1, 2, 5, 10, 30 and 60 s.

## Backlog: 4,875,000 records

`make produce-load-data` sent 4,875,000 records in the stream's mix. The producers finished in under 6 minutes (card: 3,125,000 records in 346 s, with 0 errors), so the consumers worked through a backlog.

| | |
| --- | --- |
| Window | 12:40:10 to 12:59:40 UTC, about 19.5 minutes |
| Rows stored | 4,875,000; the table went from 240,001 to 5,115,001 rows |
| Mean rate, all consumers | about 4,170 rows a second |
| Peak 1-minute rate, all consumers | 7,341 rows a second |
| Dead-lettered | 0 |
| Consumer lag afterwards | 0 on every group |
| Default partition | 0 rows; the rows sit in 19 monthly partitions |

Per consumer, while it had a backlog:

| Consumer | Mean rows a second | Peak rows a second |
| --- | --- | --- |
| card | 2,607 | 3,868 |
| eft | 1,955 | 3,388 |
| debit-order | 1,386 | 2,424 |
| internal-transfer | 1,033 | 1,570 |

Every flush was a size flush of 100 rows (49,163 flushes):

| | p50 | p95 | p99 | Mean |
| --- | --- | --- | --- | --- |
| Whole flush (insert and offset commit) | 33 ms | 134 ms | 246 ms | 43 ms |
| Insert alone | 22 ms | 97 ms | 236 ms | 33 ms |

Lag is meaningless during a backlog, since records wait their turn. It sat above the histogram's top bucket of 60 s.

## Stream: lag at a steady rate

`make produce-stream` sends records at a fixed rate per source, stamped with the time they're sent. Each run used the stream's mix, card 25 : eft 8 : debit-order 4 : internal-transfer 2, scaled to the target. At 250 a second, for example, that is 160, 51, 26 and 13. Each run was measured after a 20-second warm-up.

| Target | Window | Sent | Peak stored a second | Lag p50 | Lag p95 | Lag p99 | Flush p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 250/s | 5 min | 78,629 in 314.5 s | 252 | 0.43 s | **1.74 s** | 1.97 s | 47 ms |
| 2,000/s | 3 min | 392,683 in 196.4 s | 2,000 | 0.07 s | 0.46 s | 0.81 s | 35 ms |
| 4,000/s | 3 min | 783,938 in 196.1 s | 4,022 | 0.09 s | 0.91 s | 3.63 s | 85 ms |
| 5,000/s | 3 min | 979,209 in 195.9 s | 5,310 | 1.41 s | 9.92 s | 25.8 s | 96 ms |

**Lag at 250/s is mostly the linger.** At 250 a second, eft gets 51 records a second, debit-order 26 and internal-transfer 13. None of them fills a 100-record batch within 2 s, so their batches go out on the linger: 294 of the 927 flushes. At 2,000 a second every batch fills within a second, so lag is lower at the higher rate.

**At 5,000 a second, card is the limit.** Card needs 3,200 records a second at that rate, and its one consumer averaged 2,796. The other three kept up. With every record queuing behind card's backlog, lag p95 reached 9.9 s. It went back to 0 within seconds of the producers stopping.

## What limits it

- **One consumer per source.** Each source's consumer reads all 12 partitions of its topic in one loop, one flush at a time. At about 2,600–2,800 rows a second sustained, the card consumer is the first to saturate.
- **The insert dominates a flush.** At 100 rows it takes 20–35 ms, and its p95 roughly doubles as the database gets busier.

There are two ways to raise the ceiling, neither of them built:

- **More consumers for card:** a topic's 12 partitions allow up to 12 instances of one source's consumer in its group.
- **Larger batches:** `KAFKA_BATCH_SIZE` above 100, within the 1 MiB fetch.

## What this doesn't show

- **A single machine:** with everything on one laptop VM, the producers, Kafka and Postgres compete for the same 4 CPUs. A production deployment would spread them out.
- **Short runs:** the stream steps ran for 3–5 minutes each, which is enough to see whether lag stays flat or climbs, but not hours of steady state.
