# 0005. One partitioned transactions table with bounded JSON metadata

- **Status:** Accepted
- **Where it lives:** [`0000_types_and_tables.sql`](../../database/migrations/0000_types_and_tables.sql), [`0002_maintenance.sql`](../../database/migrations/0002_maintenance.sql), [`0003_monitoring.sql`](../../database/migrations/0003_monitoring.sql)
- **Related:** [0003](0003-at-least-once-crash-only.md) (the unique key), [0004](0004-versioned-rules-read-time-overrides.md) (the override tables), [0006](0006-database-roles-enforce-writes.md)

## Context

Four sources share most of their fields: who, which account, when, how much, which way, and a description. Each also has a few of its own, such as a card's merchant category code or a debit order's mandate.

Every API read is about one user: a page of their transactions, or a summary over a date window. Data is kept for 18 months and must expire cheaply. Ingest must be idempotent.

## Decision

**One table, `txn_agg.transactions`, holds every source's transactions.**

- **Typed columns** hold everything a query touches: the ids, `transaction_type`, `external_id`, `occurred_at`, `credit_debit_indicator`, `status`, the amount, the descriptions, and the category with the rule that chose it.
- **The amount** is `amount_minor bigint CHECK (amount_minor > 0)`, beside a 3-letter `currency`. Its sign is the credit/debit indicator, never the number.
- **Per-source fields** go in one `metadata jsonb` column. The source's normaliser writes them, and nothing in SQL filters on them.
- **The primary key** is `(transaction_id, occurred_at)`. `transaction_id` defaults to Postgres 18's `uuidv7()`.
- **The unique key** `(transaction_type, external_id, occurred_at)` makes ingest idempotent ([0003](0003-at-least-once-crash-only.md)).

**The table is partitioned by month on `occurred_at`, managed by pg_partman.**

- Partitions are created ahead of time, and a default partition catches anything outside the range.
- Retention is 18 months, and expiry drops a whole partition. Nothing is ever deleted row by row.
- pg_cron runs partman's maintenance hourly, and `ANALYZE`s the partitioned parents half an hour later, because Postgres never auto-analyses a partitioned parent.

**One covering index serves every user-scoped read:**

```sql
(user_id, occurred_at DESC, transaction_id DESC)
INCLUDE (transaction_type, credit_debit_indicator, status, amount_minor, currency, category_id, short_description, account_id)
```

A page of a user's transactions is an index scan inside the partitions its window touches.

**Side tables are for other entities, never for pieces of a transaction.**

- **The two override tables** ([0004](0004-versioned-rules-read-time-overrides.md)) hold a user's preferences, not parts of the fact. They have their own writer, the API.
- **`user_transaction_overrides`** is partitioned on the same calendar with the same retention. It has no foreign key to `transactions`, so the two sets of partitions drop independently. An orphaned override matches nothing.

**Our objects live in the `txn_agg` schema.** The monitoring views live in `monitoring`, and `public` holds only what extensions install there.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A table per source, or per-source detail tables joined to a core | Every read crosses sources, so every read becomes a union or a join. Detail tables with foreign keys tie their partition drops to the core's. |
| A typed column for every per-source field | About twenty mostly-empty columns, and a migration for every new field, with no query that needs them. |
| Key-value rows (EAV) | Worse than JSON in Postgres on every count. |
| A GIN index on `metadata` | The keys are known and need equality, not containment. GIN can't do index-only scans, and it would be one more index per partition. |
| Partitioning by `user_id` | Expiry would become a DELETE of every old row instead of dropping a partition. The covering index already gives per-user locality. |
| An event store with projections | Kafka is already the log and the consumer already the projector. A second log is double bookkeeping. |
| A per-user key-value store | It loses the one-statement, all-or-nothing batch insert with its unique key. |
| An analytics database for the summaries | Every summary is one user's rows, a few thousand at most. That is an index range, not an analytics workload. |

## Consequences

- **One write path:** there is one insert statement. A new source needs a normaliser, a schema and one new value in the `transaction_type` enum, but no new table or column.
- **No statistics on JSON keys:** Postgres keeps none. The day a key needs filtering, the ladder is an expression index, then `CREATE STATISTICS`, then a `STORED` generated column.
- **The database doesn't check `metadata`:** the column is nullable with no CHECK, and its keys are fixed only by the normalisers' code.
- **Corrected timestamps duplicate rows:** the unique key includes `occurred_at`, so a source that re-sends an id with a corrected time creates a second row.
- **The id isn't the transaction's time:** the time inside `transaction_id` is insert time, not when the transaction happened. It only breaks ties between rows with the same `occurred_at`.
- **Old rows land in the default partition:** a row older than the partition range lands there and stays until someone moves it.

## Revisit when

- **Writes outgrow one table:** write, vacuum or index pressure reaches about ten times today's design load. Shard by `user_id` (Citus, say), or build a per-user read store.
- **A metadata key needs filtering:** a key gets a query path. Climb the ladder above.
- **Merchant analytics:** a cross-user analytics surface is needed. Add an analytics store beside Postgres, not instead of it.
