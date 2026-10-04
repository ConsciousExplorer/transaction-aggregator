import logging
import secrets
import signal
from collections.abc import Iterator
from datetime import UTC, datetime
from importlib.metadata import version
from typing import Any

from avro_datagen import generate
from confluent_kafka import Producer
from confluent_kafka.schema_registry import SchemaRegistryClient

from config import AppConfig, get_config
from producer_core import build_serializer, produce_records, resolve_key_fields
from stream import stream_records

logger = logging.getLogger(__name__)


def main():
    # Validate expected environment variables
    config = get_config()
    logging.basicConfig(
        level=config.app.log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # docker compose stop sends SIGTERM: treat it as Ctrl-C so produce_records flushes
    signal.signal(signal.SIGTERM, signal.default_int_handler)

    if config.producer.mode == "stream":
        logger.info(
            "starting producer for topic %s in stream mode at %g messages/s",
            config.kafka.topic,
            config.producer.rate,
        )
        records = stream_records(config.generator.schema_path, config.producer.rate)
    else:
        logger.info(
            "starting producer for topic %s in oneshot mode", config.kafka.topic
        )
        records = oneshot_records(config)

    schema_registry = SchemaRegistryClient({"url": config.schemaRegistry.url})
    # TopicNameStrategy: the value schema for topic T lives under subject "T-value"
    subject = f"{config.kafka.topic}-value"
    serializer, schema = build_serializer(schema_registry, subject)
    key_fields = resolve_key_fields(schema, config.kafka.key_fields)

    producer = Producer(config.kafka.to_producer_config())

    stats = produce_records(
        producer,
        serializer,
        config.kafka.topic,
        records,
        key_fields,
        static_headers={
            "x-producer": f"producers/{version('producers')}",
        },
    )
    logger.info(
        "produced %d records (%d errors, %d undelivered) in %.1fs",
        stats.produced,
        stats.errors,
        stats.undelivered,
        stats.elapsed_s,
    )


def oneshot_records(config: AppConfig) -> Iterator[dict[str, Any]]:
    # Random unless GENERATOR_SEED pins it; pin it for reproducible runs
    seed = config.generator.seed
    seed_source = "env"
    if seed is None:
        seed = secrets.randbelow(2**31)
        seed_source = "random"

    anchor_date = config.generator.anchor_date
    anchor_source = "env"
    if anchor_date is None:
        anchor_date = datetime.now(UTC).date()
        anchor_source = "today"
    logger.info(
        "generator seed %d (%s), history ending %s (%s) — rerun with "
        "GENERATOR_SEED=%d GENERATOR_ANCHOR_DATE=%s to reproduce this corpus",
        seed,
        seed_source,
        anchor_date,
        anchor_source,
        seed,
        anchor_date,
    )

    anchor = datetime(anchor_date.year, anchor_date.month, anchor_date.day, tzinfo=UTC)
    return generate(
        schema_path=config.generator.schema_path,
        count=config.generator.count,
        seed=seed,
        now=anchor,
    )


if __name__ == "__main__":
    main()
