# Transaction Aggregator Producers

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![uv](https://img.shields.io/badge/uv-packages-DE5FE9?logo=uv&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache%20Kafka-4.0-231F20?logo=apachekafka&logoColor=white)
![confluent-kafka](https://img.shields.io/static/v1?label=client&message=confluent-kafka%202.15&color=231F20&logo=apachekafka&logoColor=white)
![Avro](https://img.shields.io/badge/Avro-avro--datagen%200.6-1A5C96?logo=apacheavro&logoColor=white)
![Schema Registry](https://img.shields.io/badge/Schema%20Registry-Confluent%208-0A3D62)
![Pydantic](https://img.shields.io/badge/Pydantic-2-E92063?logo=pydantic&logoColor=white)
![pytest](https://img.shields.io/badge/tests-pytest-0A9EDC?logo=pytest&logoColor=white)
![Ruff](https://img.shields.io/badge/Ruff-lint-D7FF64?logo=ruff&logoColor=black)
![Pyright](https://img.shields.io/badge/types-Pyright-2C6E9B)
![Docker](https://img.shields.io/badge/Docker-uv%3Apython3.13-2496ED?logo=docker&logoColor=white)

This app generates realistic bank transactions and publishes them to Kafka as Avro, so the rest of the system has something to ingest.

It is one app in the [transaction-aggregator](../../README.md) monorepo. The same image runs five times, once per transaction source (`card`, `eft`, `loan`, `debit-order`, `internal-transfer`). Each instance generates from its own schema in [`schemas/`](../../schemas) and publishes to its own topic, `transactions.<source>`.

## How it works

- **Generated from the schema.** [avro-datagen](https://pypi.org/project/avro-datagen/) builds each record from the source's `.avsc` file, following the generator hints in the schema. Customers and accounts come from fixed pools (5,000 customers, up to 3 accounts each), so every run and every source shares the same customers.
- **Two modes.**
  - `oneshot`, the default, sends `GENERATOR_COUNT` records covering the 18 months up to `GENERATOR_ANCHOR_DATE`, then exits.
  - `stream` sends `PRODUCER_RATE` records a second until it's stopped, each stamped with the time it was sent.
- **Repeatable.** In `oneshot` mode, the same `GENERATOR_SEED` and `GENERATOR_ANCHOR_DATE` produce the same records. Without a seed it picks one and logs it, so any run can be repeated.
- **The registry's schema, never its own.** At startup the serializer is pinned to the topic's latest schema in Schema Registry, and it never registers one. Compose's `schemas-register` step does that.
- **Keyed by customer.** The message key is the field the schema names in `partitionKey` (`customerId`), so each customer's transactions stay in order on one partition. `KAFKA_KEY_FIELDS` is used only when a schema names none.
- **Headers.** Every message carries `x-producer` (for example `producer-card/0.1.0`) and a fresh W3C `traceparent`. The consumer links its batch spans to that trace.
- **Delivery.** Sends use `acks=all` with idempotence on. At the end, or on SIGTERM, the producer flushes what it has queued and logs one line: records produced, errors, undelivered, and the time taken.

## Configuration

All configuration comes from environment variables, or a `.env` file, validated at startup by [`src/config.py`](src/config.py). The variables that change behaviour:

| Variable | Default | Effect |
| --- | --- | --- |
| `KAFKA_TOPIC` | required | The topic to publish to; its schema is the `<topic>-value` subject |
| `KAFKA_BROKERS` | required | Comma-separated broker list |
| `KAFKA_USERNAME` / `KAFKA_PASSWORD` | required | SASL credentials |
| `KAFKA_SECURITY_PROTOCOL` | `SASL_SSL` | Compose uses `SASL_PLAINTEXT` |
| `KAFKA_KEY_FIELDS` | `customerId` | Key fields for a schema without `partitionKey` |
| `SCHEMA_REGISTRY_URL` | required | Read once at startup |
| `GENERATOR_SCHEMA_PATH` | `./schemas` | The source's `.avsc` file |
| `GENERATOR_COUNT` | `500` | Records sent in `oneshot` mode |
| `GENERATOR_SEED` | random | Pin it to send the same records again |
| `GENERATOR_ANCHOR_DATE` | today | The day the 18 months of history end |
| `PRODUCER_NAME` | required | Sent in the `x-producer` header |
| `PRODUCER_MODE` | `oneshot` | `oneshot` or `stream` |
| `PRODUCER_RATE` | `10` | Records a second in `stream` mode |
| `LOG_LEVEL` | `INFO` | `DEBUG` logs every delivery |

## Running it

The five producers run from the repo root as part of the stack:

```sh
make up                   # each producer sends its records with a fixed seed, then exits
make produce              # all five again, with a random seed
make produce-card         # one source; also produce-eft, produce-loan, produce-debit-order, produce-internal-transfer
make produce-stream       # live transactions until Ctrl-C; change a rate with CARD_RATE=100
make produce-load-data    # about 5M more transactions, for the load test
```

To run one producer from the host against that stack:

```sh
cp sample.env .env        # already points at the make up stack and the card schema
uv sync
uv run start
```

| Command | What it does |
| --- | --- |
| `uv run start` | Runs the producer with `.env` |
| `uv run pytest` | Unit tests |
| `uv run poe check` | Ruff format and lint, then Pyright |
| `uv run avro-datagen ui` | A local page that previews generated records for a schema. Compose runs the same page as `avro-datagen-ui` on http://localhost:8501. |

## Testing

The unit tests in `tests/` need neither Kafka nor Schema Registry.

| Test file | What it checks |
| --- | --- |
| `test_config.py` | Messages are keyed by `customerId` by default, and `PRODUCER_NAME` is required |
| `test_event_time_anchor.py` | History spans the 18 months before the anchor date. The same seed and anchor give the same records. Every seed and source draws from the same customers. |
| `test_producer_stamping.py` | A record is sent as generated, with `x-producer` and a fresh `traceparent` |
| `test_stream.py` | Stream mode sends record *i* at start + *i* / rate without drifting, stamps the send time, and never repeats a transaction id |
