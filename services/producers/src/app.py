import logging
import time
from collections.abc import Sequence
from typing import Any

from avro_datagen import generate
from confluent_kafka import KafkaException, Producer
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroSerializer
from confluent_kafka.serialization import (
    MessageField,
    SerializationContext,
)

from config import get_config

logger = logging.getLogger(__name__)


# per-message delivery callback (triggered by poll() or flush())
# when a message has been successfully delivered or permanently
# failed delivery (after retries).
def kafka_delivery_callback(err, msg):
    if err:
        logger.error("Message failed delivery: %s", err)
    else:
        key = msg.key().decode("utf-8") if msg.key() else None
        logger.debug(
            "Delivered to %s [%d] @ offset %d: key=%s (%d bytes)",
            msg.topic(),
            msg.partition(),
            msg.offset(),
            key,
            len(msg.value()),
        )


def extract_key(record: dict[str, Any], candidates: Sequence[str]) -> str | None:
    """Return the first non-null candidate field as the partition key."""
    for candidate in candidates:
        field = record.get(candidate)
        if field is not None:
            return str(field)
    return None


def main():
    # Validate expected environment variables
    config = get_config()
    logging.basicConfig(
        level=config.app.log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("starting producer for topic %s", config.kafka.topic)

    sr = SchemaRegistryClient({"url": config.schemaRegistry.url})
    registered_schema = sr.get_latest_version(config.schemaRegistry.schema_name)

    # pyright can't see AvroSerializer's real signature (__init__ = __init_impl alias)
    avro_serializer = AvroSerializer(
        sr,  # pyright: ignore[reportCallIssue]
        schema_str=registered_schema.schema.schema_str,  # the REGISTRY's text, deliberately
        conf={
            "auto.register.schemas": False,
            "use.latest.version": False,
            # Look up the schema under the subject named in .env instead of the
            # default topic-name strategy ("<topic>-value", which isn't registered).
            "subject.name.strategy": lambda ctx, record_name: (
                config.schemaRegistry.schema_name
            ),
        },
    )
    ser_ctx = SerializationContext(config.kafka.topic, MessageField.VALUE)

    producer = Producer(
        {
            **config.kafka.to_producer_config(),
        }
    )

    produced = 0
    errors = 0
    start_time = time.monotonic()

    try:
        # Main producer loop
        for record in generate(
            schema_path=config.generator.schema_path,
            count=config.generator.count,
            seed=config.generator.seed,
        ):
            value = avro_serializer(record, ser_ctx)
            key = extract_key(record, config.kafka.key_fields)

            try:
                producer.produce(
                    topic=config.kafka.topic,
                    value=value,
                    key=key,
                    callback=kafka_delivery_callback,
                )
                produced += 1
            except BufferError:
                # Local queue full: drain it, then retry once
                producer.flush(timeout=5)
                producer.produce(
                    topic=config.kafka.topic,
                    value=value,
                    key=key,
                    callback=kafka_delivery_callback,
                )
                produced += 1
            except KafkaException:
                errors += 1
                logger.exception("failed to produce record")

            # Serve delivery callbacks for previously sent messages
            producer.poll(0)

    except KeyboardInterrupt:
        logger.info("interrupted, flushing outstanding messages")
    finally:
        undelivered = producer.flush(timeout=30)
        elapsed = time.monotonic() - start_time
        logger.info(
            "produced %d records (%d errors, %d undelivered) in %.1fs",
            produced,
            errors,
            undelivered,
            elapsed,
        )


if __name__ == "__main__":
    main()
