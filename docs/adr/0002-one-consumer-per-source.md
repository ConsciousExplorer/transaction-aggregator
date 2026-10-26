# 0002. One consumer codebase, deployed once per source

- **Status:** Accepted
- **Where it lives:** [`apps/consumer`](../../apps/consumer), the four `consumer-*` services in [`docker-compose.yaml`](../../infrastructure/docker-compose.yaml), [`init-kafka.sh`](../../infrastructure/kafka/init-kafka.sh)
- **Related:** [0001](0001-avro-schema-registry-contract.md), [0003](0003-at-least-once-crash-only.md)

## Context

There are four sources: card, EFT, debit order and internal transfer. Each has its own topic, schema and fields, but they all end in the same table, through the same steps: decode, normalise, categorise, insert.

Card traffic dwarfs the others. A slow or broken source should not hold the others back.

## Decision

**One codebase, run as four instances, each reading one topic.**

- All four compose services build `apps/consumer`. Two settings choose the source: `TRANSACTION_TYPE` (`card`, `eft`, `debit_order`, `internal_transfer`) and `KAFKA_TOPIC` (`transactions.card` and so on).
- Each instance derives the rest from those two: its consumer group (`transaction-consumer-<type>`), its dead-letter topic (`<topic>.dlq`) and its schema subject (`<topic>-value`).
- What differs per source is a normaliser and a Zod schema in the code, chosen by `TRANSACTION_TYPE`. Everything after normalising is shared.

**Each source has its own dead-letter topic.**

- `init-kafka.sh` creates the topics, and the broker never auto-creates one.
- Each source topic has 12 partitions and 7 days' retention.
- Each `.dlq` topic has 3 partitions and 30 days' retention.
- A dead-letter record is the original bytes and headers, with the reason and source position added as headers. A redrive therefore puts back exactly what arrived, onto the one topic whose schema it fits.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| One service reading all four topics | A poison message, a backlog or a crash on one source stops or slows all four. It also has to dispatch per message to the right normaliser. |
| Four codebases | Everything after normalising would be copied four times and drift apart. |
| One dead-letter topic for all sources | A redrive would have to sort records by schema first, and the records of one broken source would be mixed with the others'. |

## Consequences

- **Isolation:** sources fail, lag and restart independently. Stopping `consumer-eft` stops only EFT ingest.
- **Scaling:** card can get more instances (up to its 12 partitions) without touching the others.
- **Duplicated settings:** compose repeats a service block four times, and they differ only in those two settings. A change to one setting means four edits.
- **Shared resources:** all four share the broker, Postgres and one Kafka user. A database outage stops them all, by design ([0003](0003-at-least-once-crash-only.md)).
- **Shared code:** a bug in the shared code reaches every source at once.

## Revisit when

- A source needs different processing after normalising, not just a different normaliser.
- The number of sources grows enough that four-way duplication in deployment config costs more than it isolates.
