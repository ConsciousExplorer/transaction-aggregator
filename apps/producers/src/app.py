import logging
import secrets
from datetime import UTC, datetime
from importlib.metadata import version

from avro_datagen import generate
from confluent_kafka import Producer
from confluent_kafka.schema_registry import SchemaRegistryClient

from config import get_config
from producer_core import build_serializer, produce_records, resolve_key_fields

logger = logging.getLogger(__name__)


def main():
    # Validate expected environment variables
    config = get_config()
    logging.basicConfig(
        level=config.app.log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("starting producer for topic %s", config.kafka.topic)

    schema_registry = SchemaRegistryClient({"url": config.schemaRegistry.url})
    # TopicNameStrategy: the value schema for topic T lives under subject "T-value"
    subject = f"{config.kafka.topic}-value"
    serializer, schema = build_serializer(schema_registry, subject)
    key_fields = resolve_key_fields(schema, config.kafka.key_fields)

    producer = Producer(config.kafka.to_producer_config())

    # The seed should be random for chaos and tests.
    # For reproduceable tests, a seed value should be set to ensure
    # all test records are not randomised.
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
    records = generate(
        schema_path=config.generator.schema_path,
        count=config.generator.count,
        seed=seed,
        now=anchor,
    )
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


if __name__ == "__main__":
    main()
