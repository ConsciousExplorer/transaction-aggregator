import logging
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

    records = generate(
        schema_path=config.generator.schema_path,
        count=config.generator.count,
        seed=config.generator.seed,
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
