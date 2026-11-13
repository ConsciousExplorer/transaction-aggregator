# 0003. At-least-once delivery into an idempotent table; crash rather than retry

- **Status:** Accepted
- **Where it lives:** [`kafka.ts`](../../apps/consumer/src/integrations/events/kafka.ts), [`transactionBatchHandler.ts`](../../apps/consumer/src/integrations/events/handlers/transactionBatchHandler.ts), [`transaction-ingester.ts`](../../apps/consumer/src/services/transaction-ingester.ts), [`postgres.ts`](../../apps/consumer/src/errors/postgres.ts), [`transaction-repository.ts`](../../apps/consumer/src/integrations/database/repositories/transaction-repository.ts), [`app.ts`](../../apps/consumer/src/app.ts)
- **See it:** [message-flow.html](message-flow.html) (every branch a record can take), [consumer-batching.html](consumer-batching.html) (fetches, flushes and a failed flush)

## Context

Kafka delivers at least once: after a crash or a rebalance, a consumer reads again from its last committed offset. Producers can also send the same transaction twice. The table must end up with each transaction exactly once anyway.

Failures come in two kinds:

- **Something is wrong with one message:** it won't decode, it fails validation, or Postgres rejects the row.
- **Something is wrong with the infrastructure:** Postgres is down or slow, or the network drops a connection.

An earlier version logged a failed insert and committed the offsets anyway, so the batch was lost.

## Decision

**Deduplicate in the database, on the business key.** The batch insert is one statement:

```sql
INSERT … SELECT … FROM json_populate_recordset(…) ON CONFLICT (transaction_type, external_id, occurred_at) DO NOTHING
```

- A transaction's identity is its source and its source's id. The record's Kafka position, `(topic, partition, offset)`, is never used to dedupe, because a producer re-send is a new record with a new offset.
- `occurred_at` is in the key only because Postgres requires a partitioned table's unique key to include the partition key.

**Commit offsets only after the work is done.**

- Auto-commit is off. A batch's offsets are committed after its insert has committed and every dead-letter send has been acknowledged (`acks: all`).
- The commit takes the highest offset per partition.
- A commit that fails ends the consumer like any other failure. The rows are stored, so the restart reads the batch again and the insert skips them as duplicates.

**Prepare each record, then insert the batch.** Every valid record is normalised, validated and categorised on its own first. One that can't become a row is set aside for the dead-letter topic before any SQL runs, and the rest of the batch still goes in one statement. Only a row Postgres itself refuses costs a row-by-row retry.

**Two classes of failure, two outcomes.**

| Failure | Outcome |
| --- | --- |
| Bytes that won't decode | Dead-lettered as `deserialisation`, and the batch continues |
| A message that fails normalising or validation | Dead-lettered as `processing` before the insert runs; the rest of the batch still goes in one statement |
| A row Postgres rejects (a `DatabaseError` with SQLSTATE class 22 or 23) | The batch is retried one row at a time, so only the bad row is dead-lettered |
| Any other database error, a dropped connection, or a statement past its timeout (`DATABASE_STATEMENT_TIMEOUT_MS`) | `RetryableError`: the process exits with code 1 and nothing is committed |
| A schema id the consumer hasn't loaded | It fetches that schema from the registry before it decodes the message, and carries on |
| The registry can't supply that schema: it is unreachable, or has no such id | The process exits with nothing committed, and the restart asks again |

**Crash rather than retry.**

- The consumer has no retry loop. On an infrastructure failure it exits uncommitted.
- Docker's `restart: unless-stopped`, with its growing delay between attempts, is the retry. The restarted consumer reads the batch again, and the insert skips whatever already landed.

**Stop without draining.** On SIGTERM the consumer calls `close(true)` and leaves its group. A batch that was buffered or mid-flush was never committed, so it is read again after the restart.

**Batches and backpressure:**

- A batch is whatever is buffered when the loop gets to it, capped at 1,000 messages. The broker holds a fetch until 32 KiB are ready or 2 s have passed (`fetch.min.bytes`, `fetch.max.wait.ms`), which is where messages gather at low rates; the consumer has no timer of its own.
- The `for await` loop waits on each flush, so only one ever runs, and it pulls nothing more until that flush and its commit are done. A failed flush ends the loop.
- Memory is bounded by the stream's 1,024-message buffer, a 1 MiB fetch per broker and the batch in progress. With one broker that is about 4,900 records at most, however large the backlog.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Kafka transactions (exactly-once) | They cover Kafka to Kafka. The sink is Postgres, which still has to dedupe, so this adds transactional ids and fencing for nothing. |
| Deduplicating in the app (a cache of seen ids) | A cache sees a window. The unique index sees every row still kept. |
| A content hash or the Kafka offset as the key | A producer re-send gets a new offset. A hash changes when any field is corrected, and so makes duplicates. |
| An in-process retry loop with backoff | The restart already retries, with no extra state in the process. |
| A draining shutdown with flags and timers | It saves a few seconds of replay and adds no correctness. |
| Exiting on an unknown schema id, so the restart loads it | Every producer rollout restarted every consumer instance, each with a group rebalance. One registry read does the same job. |
| Dead-lettering a message with an unknown schema id | Every producer rollout would turn into a redrive. |
| Dead-lettering a message whose schema id the registry doesn't have | It needs a second rule, to tell a 404 from an outage. One rule covers every registry failure: stop, and ask again after the restart. |
| `pause()` and `resume()` for backpressure | The loop already stops pulling while it waits on a flush. |
| A linger timer in the consumer, flushing a partial batch 2 s after its first message | The broker already holds a fetch until `fetch.min.bytes` are ready or `fetch.max.wait.ms` has passed, so it gathers the batch. A timer that fires outside the loop needed a promise chain to stop two flushes overlapping, and a failed flush had to poison that chain so nothing committed past it. Flushing when the batch is full or the stream is empty needs none of that. |

## Consequences

- **No data loss in an outage:** the offsets stay behind, and the restart replays.
- **Restarts aren't free:** each one costs a group rebalance and a boot, a few seconds.
- **`restart: unless-stopped` is load-bearing:** without it, a five-second database blip would stop that source for good.
- **Dead-letter duplicates:** a replay can dead-letter the same record twice, because the dead-letter topic has no dedupe. A redrive must cope with that.
- **A bug can dead-letter good messages:** an unexpected error while normalising or categorising is dead-lettered, not a crash. After the fix, redrive the affected messages.
- **Corrected timestamps:** a source that re-sends an id with a corrected `occurred_at` creates a second row, and nothing detects it.
- **Corrupt frames stop a source:** a corrupt message whose bytes happen to start like a Confluent frame names a schema id that doesn't exist, and the restart can't fix that. The consumer stops on it every time, logging its partition and offset, until someone skips it by hand. Records on that partition between the committed offset and the corrupt one were never stored, so they have to be produced again before the offset moves past it.
- **New groups replay everything retained:** a new consumer group starts from the earliest offset and reads up to 7 days again. That is safe only because the insert is idempotent.
