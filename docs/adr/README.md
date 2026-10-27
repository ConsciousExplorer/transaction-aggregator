# Architecture decisions

## Decisions

Each record states what was decided, what was rejected and why, and what would make us look again. 0001 to 0011 follow a transaction's path, from the wire to the API. 0012 is about the data that drives it.

| ADR | Decision |
| --- | --- |
| [0001](0001-avro-schema-registry-contract.md) | Avro and Schema Registry are the contract between producers and consumers |
| [0002](0002-one-consumer-per-source.md) | One consumer codebase, deployed once per source |
| [0003](0003-at-least-once-crash-only.md) | At-least-once delivery into an idempotent table; crash rather than retry |
| [0004](0004-versioned-rules-read-time-overrides.md) | Rules categorise at ingest from versioned rule sets; user overrides apply on read |
| [0005](0005-one-partitioned-table.md) | One partitioned transactions table with bounded JSON metadata |
| [0006](0006-database-roles-enforce-writes.md) | Database roles decide who can write what |
| [0007](0007-routes-and-repositories.md) | API routes call repositories directly; Zod is the one contract source |
| [0008](0008-service-to-service-auth.md) | Service-to-service auth: the calling app chooses the user |
| [0009](0009-keyset-paging.md) | Keyset paging with an opaque cursor |
| [0010](0010-wire-conventions.md) | Money, categories and date windows on the wire |
| [0011](0011-egress.md) | Other systems read through the API; events and exports come later |
| [0012](0012-test-data-from-the-schemas.md) | Test data is generated from the schemas, with avro-datagen |

## How it works

Four self-contained HTML pages, each about one part of the system. GitHub shows their source, so open them in a browser after cloning:

```sh
open docs/adr/message-flow.html        # macOS; xdg-open on Linux
```

| Page | What it shows |
| --- | --- |
| [message-flow.html](message-flow.html) | The path of one transaction: generated and produced as Avro, fetched, deserialised, normalised, categorised and inserted, and every branch to the dead-letter topic or to a restart. A table lists what happens to each kind of record, and whether its offset is committed. |
| [consumer-batching.html](consumer-batching.html) | A playable model of the consumer's batching loop: fetches into the stream's buffer, the `for await` loop filling a batch, size and linger flushes, the offset commit, and what a failed flush does. Switch between a backlog, a steady stream and a trickle, or inject a poison record, a bad row or a Postgres outage. |
| [keyset-paging.html](keyset-paging.html) | Keyset paging against offset paging on the same data. Add or remove rows while two clients page, and see which one repeats or loses rows. Also shows what a `links.next` cursor carries, the SQL it runs, and `buildKeysetPage` step by step. |
| [ci-pipelines.html](ci-pipelines.html) | The six GitHub Actions workflows: what each one watches and runs, when an app needs a version bump, and what the API contract and Avro schema checks let through, with each change tried against the real files. |

The pages load their fonts from Google Fonts and need nothing else.
