# 0012. Test data is generated from the schemas, with avro-datagen

- **Status:** Accepted
- **Where it lives:** the `arg.properties` hints in [`schemas/`](../../schemas), [`app.py`](../../apps/producers/src/app.py) and [`stream.py`](../../apps/producers/src/stream.py) in the producers, [`register.py`](../../infrastructure/schema-registry/register.py), the `SEED` and `ANCHOR_DATE` defaults in the [`Makefile`](../../Makefile), [`test_event_time_anchor.py`](../../apps/producers/tests/test_event_time_anchor.py)
- **Related:** [0001](0001-avro-schema-registry-contract.md) (the schemas), [0003](0003-at-least-once-crash-only.md) (what a re-send proves), [0005](0005-one-partitioned-table.md) (partitions and retention)

## Context

The system needs transactions to ingest, and real ones are off the table. There is no source system, and real bank transactions are personal financial data.

Synthetic data is harder than it looks, because each part of the system tests something different:

- **The categoriser** needs merchants, merchant category codes, descriptions and amounts that agree with each other. A grocery merchant with a fuel code and an R40,000 amount tests nothing.
- **Per-user reads** need the same customers in every source, so that one user's list and summary mix card, EFT, debit orders and transfers. Each customer needs a few accounts, and the same customers on every run.
- **Partitions, retention and the date-window cap** need 18 months of history spread across monthly partitions, not a burst of today's transactions.
- **Idempotency** needs the exact same records again on demand. **The load test** needs millions of new ones.
- **The contract** needs every record to be valid against the schema in the registry. A generator with its own idea of the record drifts from the schema at the first change.
- **Lag and batching** need a steady live stream, in a realistic mix where card traffic dominates.

## Decision

**Every record is generated from its source's own Avro schema, by avro-datagen.**

The hints live in the schema. Each field's `arg.properties` says how to generate it, following the convention Confluent's avro-random-generator uses:

| Hint | What it does | Example in `card.avsc` |
| --- | --- | --- |
| `options` | Picks one value; repeating a value weights it | `creditDebitIndicator`: `["debit", "debit", …]` |
| `range` | Picks a number, or a time relative to the anchor | `timestamp`: `"-548d"` to `"now"` |
| `rules` | Makes a field depend on another one | the merchant, merchant code and amount follow the `category` picked first |
| `pool` | Draws from a fixed, seeded set | `customerId`: 5,000 customers; `accountId`: up to 3 per customer |
| `faker` | Fills in a realistic string | `cardLast4` |

**Shared customers:** pools are seeded by their own name (`customers-v1`, `accounts-v1`), never by the run's seed, so every run and every source draws the same customers.

**The registry never sees the hints.** `register.py` strips `arg.properties` before registering a schema, and keeps `partitionKey`.

**A run is repeatable from its seed and its anchor day.** The producer calls `generate(schema_path, count, seed, now)`. The seed fixes the records, and `now`, the anchor, is the day the 18 months of history end.

- `make up` pins both (`SEED=42` and `ANCHOR_DATE`), so every `make up` sends the same records. Sending them again to the same database inserts nothing.
- `make produce` picks a random seed and logs it, so any run can be repeated.

**Stream mode** sends records at a fixed rate per source until it's stopped. Each record is stamped with the time it was sent, and each batch gets a fresh random seed. `make produce-stream` starts it.

**Load data goes through the whole pipeline.** `make produce-load-data` sends about 5 million more records through the producers, Kafka and the consumers.

**The failure cases need no generator flags:**

- **Duplicates:** send the same seed and anchor again.
- **Late arrivals:** every record falls somewhere in the 18 months before the anchor, so the whole corpus arrives out of order.
- **Malformed messages:** produce one by hand, in kafbat UI or with the console producer.

**A preview page** shows generated records for a schema: `uv run avro-datagen ui`, or the `avro-datagen-ui` service in compose on port 8501.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A hand-written generator per source (Faker scripts) | Four more copies of the record shape, outside the schema. Every schema change needs a matching code change, and the two drift. |
| Confluent's kafka-connect-datagen | It uses the same annotation idea, but runs inside Kafka Connect on the JVM, which the stack doesn't otherwise need. The realism here depends on fields that follow other fields, and on customers shared across topics. |
| Anonymised production data | There is none, and if there were, it would still be personal financial data. |
| Fixture files in the repo | They are small, they age out of the 18-month window, and they have to be edited by hand whenever a schema changes. |
| Writing rows straight into Postgres with `COPY` | Faster, but it skips the producers, Kafka and the consumers, so it proves nothing about ingest, and it needs its own categorisation and partition logic. The first load run through the pipeline found an out-of-memory crash in the consumer that `COPY` would have hidden. |
| Chaos flags in the producer (a percentage of duplicate, late or malformed records) | Each condition already has a source, above. The flags would be code and tests that add nothing. |

## Consequences

- **The schema does three jobs:** it is the contract, the key definition and the test-data spec. A change to the generated data is a schema diff, reviewed like one.
- **A field exists only for the generator:** the card and debit-order schemas carry a `category` field so the generator can make the merchant, code and amount agree. It travels on the wire, and the consumer's Zod schema requires it, but nothing stores it and the categoriser never reads it.
- **Pin both values to test duplicates:** the same seed with a different anchor produces the same `externalId`s with different times, so a re-send on another day inserts new rows instead of deduplicating. Wherever duplicates are tested, pin `ANCHOR_DATE` beside the seed.
- **A fixed anchor ages:** on a database created long after `ANCHOR_DATE`, the oldest rows fall outside the partition range and land in the default partition. Moving the anchor forward is a deliberate change to the data.
- **The data is plausible, not real:** the distributions are hand-tuned weights. Load and categorisation results show how the system behaves, not a real bank's numbers.
- **One library sits under every record:** a missing feature means a fix upstream. The anchor needed one (`generate(now=…)`), which shipped in avro-datagen 0.6.0.
- **Stream mode isn't repeatable.**

## Revisit when

- Real or anonymised source data becomes available for a test environment.
- A test needs a steady rate of poison messages mixed into stream traffic: add a malformed-percentage option to stream mode.
- The data needs sequences across records that a field hint can't express, such as a debit order followed by its reversal.
