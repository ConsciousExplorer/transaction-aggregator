# 0011. Other systems read through the API

- **Status:** Accepted
- **Related:** [0003](0003-at-least-once-crash-only.md) (why a dual write fails here), [0004](0004-versioned-rules-read-time-overrides.md) (why only this system knows a user's category)

## Context

This system owns three things: the transaction facts, the system category with the rule that chose it, and each user's category preferences. The sources stay the systems of record. This is a feed, not a ledger.

Other teams could want the data in other shapes:

- a fraud or notification service that reacts to each new transaction;
- an analytics team that wants all of it.

A user's category is resolved when it is read, from their overrides ([0004](0004-versioned-rules-read-time-overrides.md)). Nothing outside this system can compute it.

## Decision

**The API is the only way out.** A reader gets one user at a time, paged, with a `tx:read` token. The portal's BFF reads this way.

**The system publishes no events and has no export.** The consumer's only Kafka producer writes dead letters, and the API has no bulk or export endpoint.

## Why not produce from the consumer after the insert

A dual write, producing an event beside the insert, fails one of two ways here:

- **It produces only for rows it inserted.** A crash between the database COMMIT and the produce then loses the event permanently. Kafka redelivers the batch, but the insert finds every row already there ([0003](0003-at-least-once-crash-only.md)), inserts nothing, and so produces nothing.
- **It produces for every message, inserted or not.** Every redelivery and every upstream re-send then becomes a duplicate event downstream. A replayed event can also carry a different category from the stored row, if the rule set changed between the first insert and the replay.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A transactional outbox: the consumer writes an outbox row in the same database transaction as the batch insert, and a relay publishes it to a topic with its own registered Avro schema | It avoids both dual-write failures, because the event row exists exactly when the fact row was inserted. No reader needs it, and it adds a table, a relay and a topic to run. |
| A scheduled export that resolves each user's effective category | No reader needs it. |
| CDC (Debezium) on the transactions table | The table's internals become other teams' contract: the `metadata` JSON, the numeric category ids, every column rename. It also needs Kafka Connect, and partitions that pg_partman creates and drops under a replication slot. |
| Read access to a replica | One `GRANT`, then every schema change breaks another team, and each team writes its own copy of the override resolution. |
| An HTTP endpoint on the consumer for on-demand categorisation | The consumer exits on any database error, runs as four per-source instances, and has no auth. |
| A bulk endpoint on the API | No reader needs bulk access; the API serves one user at a time. |

## Consequences

- Nothing extra runs or needs maintaining.
- A team that wants every new transaction as it arrives can't get it here. The API serves one user at a time.
- A user's own category reaches other systems only through the API, because overrides are per user and applied on read.
