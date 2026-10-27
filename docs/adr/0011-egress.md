# 0011. Other systems read through the API; events and exports come later

- **Status:** Accepted. Only the API part is built.
- **Related:** [0003](0003-at-least-once-crash-only.md) (why a dual write fails here), [0004](0004-versioned-rules-read-time-overrides.md) (why only this system knows a user's category)

## Context

This system owns three things: the transaction facts, the system category with the rule that chose it, and each user's category preferences. The sources stay the systems of record. This is a feed, not a ledger.

Today the only way out is the API: one user at a time, paged, behind client credentials. The consumer's only Kafka producer writes dead letters, and the API has no bulk or export endpoint.

Other teams will want the data in other shapes:

- a fraud or notification service that reacts to each new transaction;
- an analytics team that wants all of it.

A user's category is resolved when it is read, from their overrides ([0004](0004-versioned-rules-read-time-overrides.md)). Nothing outside this system can compute it.

## Decision

Each kind of reader gets its own route out:

| Reader | Route | Built |
| --- | --- | --- |
| Interactive, one user at a time (the portal's BFF) | The API, with a `tx:read` token | Yes |
| Services that react to new transactions | A transactional outbox. The consumer writes an outbox row in the same database transaction as the batch insert, and a relay publishes it to a topic with its own registered Avro schema. | No |
| Analytics and the warehouse | A scheduled export that resolves each user's effective category | No |

A row-level stream carries the facts, the system category and the rule that chose it. A user's own category is only available through the API or the export, because overrides are per user and applied on read.

## Why not produce from the consumer after the insert

A dual write, producing an event beside the insert, fails one of two ways here:

- **It produces only for rows it inserted.** A crash between the database COMMIT and the produce then loses the event permanently. Kafka redelivers the batch, but the insert finds every row already there ([0003](0003-at-least-once-crash-only.md)), inserts nothing, and so produces nothing.
- **It produces for every message, inserted or not.** Every redelivery and every upstream re-send then becomes a duplicate event downstream. A replayed event can also carry a different category from the stored row, if the rule set changed between the first insert and the replay.

An outbox avoids both: the event row exists exactly when the fact row was inserted, because both commit in one transaction.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| CDC (Debezium) on the transactions table | The table's internals become other teams' contract: the `metadata` JSON, the numeric category ids, every column rename. It also needs Kafka Connect, and partitions that pg_partman creates and drops under a replication slot. |
| Read access to a replica | One `GRANT` today, then every schema change breaks another team, and each team writes its own copy of the override resolution. |
| An HTTP endpoint on the consumer for on-demand categorisation | The consumer exits on any database error by design, runs as four per-source instances, and has no auth. If on-demand categorisation is needed, it belongs on the API, with the matcher shared as a package. |
| A bulk endpoint on the API now | Nobody has asked for one. |

## Consequences

- Nothing extra runs or needs maintaining today.
- A team that needs every new transaction as it arrives has no answer yet. The API serves one user at a time.
- The outbox is argued, not tested. How the relay's lag is monitored, and how the outbox table sits with partition retention, are unproven.

## Revisit when

- A second team needs transactions as they arrive: build the outbox and the relay.
- A warehouse asks for history: build the export.
