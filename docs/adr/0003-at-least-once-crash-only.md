# 0003. At-least-once delivery into an idempotent table; crash rather than retry

- **Status:** Accepted
- **Where it lives:** [`kafka.ts`](../../apps/consumer/src/integrations/events/kafka.ts), [`transactionBatchHandler.ts`](../../apps/consumer/src/integrations/events/handlers/transactionBatchHandler.ts), [`postgres.ts`](../../apps/consumer/src/errors/postgres.ts), [`transaction-repository.ts`](../../apps/consumer/src/integrations/database/repositories/transaction-repository.ts), [`app.ts`](../../apps/consumer/src/app.ts)
- **See it:** [message-flow.html](message-flow.html) (every branch a record can take), [consumer-batching.html](consumer-batching.html) (fetches, flushes and a failed flush)

## Context

Kafka delivers at least once: after a crash or a rebalance, a consumer reads again from its last committed offset. Producers can also send the same transaction twice. The table must end up with each transaction exactly once anyway.

Failures come in two kinds:

- **Something is wrong with one message:** it won't decode, it fails validation, or Postgres rejects the row.
- **Something is wrong with the infrastructure:** Postgres is down or slow, or the network drops a connection.

An earlier version logged a failed insert and committed the offsets anyway, so the batch was lost. That bug is what this decision exists to prevent.

## Decision

**Deduplicate in the database, on the business key.** The batch insert is one statement:

```sql
INSERT … SELECT … FROM json_populate_recordset(…) ON CONFLICT (transaction_type, external_id, occurred_at) DO NOTHING
```

- A transaction's identity is its source and its source's id. The record's Kafka position, `(topic, partition, offset)`, is never used to dedupe, because a redelivery has a new offset.
- `occurred_at` is in the key only because Postgres requires a partitioned table's unique key to include the partition key.

**Commit offsets only after the work is done.**

- Auto-commit is off. A batch's offsets are committed after its insert has committed and every dead-letter send has been acknowledged (`acks: all`).
- The commit takes the highest offset per partition.

**Two classes of failure, two outcomes.**

| Failure | Outcome |
| --- | --- |
| Bytes that won't decode | Dead-lettered as `deserialisation`, and the batch continues |
| A message that fails normalising or validation | Dead-lettered as `processing`, and the batch continues |
| A row Postgres rejects (a `DatabaseError` with SQLSTATE class 22 or 23) | The batch is retried one message at a time, so only the bad row is dead-lettered |
| Any other database error, a dropped connection, or a statement past its timeout (`DATABASE_STATEMENT_TIMEOUT_MS`) | `RetryableError`: the process exits with code 1 and nothing is committed |
| A schema id the consumer didn't load at startup | The process exits, and the restart loads the new schema version |

**Crash rather than retry.**

- The consumer has no retry loop. On an infrastructure failure it exits uncommitted.
- Docker's `restart: unless-stopped`, with its growing delay between attempts, is the retry. The restarted consumer reads the batch again, and the insert skips whatever already landed.

**Stop without draining.** On SIGTERM the consumer calls `close(true)` and leaves its group. A batch that was buffered or mid-flush was never committed, so it is read again after the restart.

**Batches and backpressure:**

- A batch closes at 100 messages, or 2 s after its first message.
- The `for await` loop waits on each size flush, so it pulls nothing more until that flush and its commit are done.
- Every flush is chained on the one before it, so two never overlap. A failed flush fails every flush queued behind it.
- Memory is bounded by one 1 MiB fetch.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Kafka transactions (exactly-once) | They cover Kafka to Kafka. The sink is Postgres, which still has to dedupe, so this adds transactional ids and fencing for nothing. |
| Deduplicating in the app (a cache of seen ids) | A cache sees a window. The unique index sees every row still kept. |
| A content hash or the Kafka offset as the key | A redelivery changes the offset. A hash changes when any field is corrected, and so makes duplicates. |
| An in-process retry loop with backoff | The restart already retries, with no extra state in the process. |
| A draining shutdown with flags and timers | It saves a few seconds of replay and adds no correctness. |
| Fetching an unknown schema from the registry on a miss | It's a second way to load schemas, with its own rules for a 404 versus an outage, for a case a restart already covers. |
| Dead-lettering a message with an unknown schema id | Every producer rollout would turn into a redrive. |
| `pause()` and `resume()` for backpressure | The loop already stops pulling while it waits on a flush. |

## Consequences

- **No data loss in an outage:** the offsets stay behind, and the restart replays.
- **Restarts aren't free:** each one costs a group rebalance and a boot, a few seconds.
- **`restart: unless-stopped` is load-bearing:** without it, a five-second database blip would stop that source for good.
- **Dead-letter duplicates:** a replay can dead-letter the same record twice, because the dead-letter topic has no dedupe. A redrive must cope with that.
- **A bug can dead-letter good messages:** an unexpected error while normalising or categorising is dead-lettered, not a crash. After the fix, redrive the affected messages.
- **Corrected timestamps:** a source that re-sends an id with a corrected `occurred_at` creates a second row, and nothing detects it.
- **Corrupt frames stop a partition:** a corrupt message whose bytes happen to start like a Confluent frame names a schema id that doesn't exist, and the restart can't fix that. The consumer stops on it every time until someone skips it by hand.
- **New groups replay everything retained:** a new consumer group starts from the earliest offset and reads up to 7 days again. That is safe only because the insert is idempotent.

## Revisit when

- Restarts and rebalances measurably hurt at real load: bring back an in-process retry with jittered backoff.
- Schema rollouts become frequent enough that a restart each time hurts.
- Another system needs an event for every stored row: see [0011](0011-egress.md).
