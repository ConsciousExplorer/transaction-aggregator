import json
import logging
import time
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, Protocol

from confluent_kafka import KafkaException
from confluent_kafka.schema_registry import SchemaRegistryClient
from confluent_kafka.schema_registry.avro import AvroSerializer
from confluent_kafka.serialization import MessageField, SerializationContext
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class KafkaProducer(Protocol):
    def produce(
        self, topic, value=None, key=None, *, callback=None, headers=None
    ) -> None: ...
    def poll(self, timeout: float) -> int: ...
    def flush(self, timeout: float) -> int: ...


class ProducerStats(BaseModel):
    produced: int
    errors: int
    undelivered: int
    elapsed_s: float


def _kafka_delivery_callback(err, msg) -> None:
    """Per-message delivery callback"""
    if err is not None:
        logger.error("Message failed delivery: %s", err)
        return
    key = msg.key().decode("utf-8") if msg.key() else None
    logger.debug(
        "Delivered to %s [%d] @ offset %d: key=%s (%d bytes)",
        msg.topic(),
        msg.partition(),
        msg.offset(),
        key,
        len(msg.value()),
    )


def build_serializer(
    sr: SchemaRegistryClient, subject: str
) -> tuple[AvroSerializer, dict[str, Any]]:
    """
    Fetch the subject's latest schema; return (serializer, parsed schema dict).
    The serializer is pinned to the registry's schema text: never auto-registers
    """
    registered_schema = sr.get_latest_version(subject)
    schema_str = registered_schema.schema.schema_str
    if schema_str is None:
        raise ValueError(f"subject {subject!r} has no schema text in the registry")
    schema_dict: dict[str, Any] = json.loads(schema_str)

    serializer = AvroSerializer(
        sr,  # pyright: ignore[reportCallIssue]
        schema_str=schema_str,
        conf={
            "auto.register.schemas": False,
            "use.latest.version": False,
        },
    )
    return serializer, schema_dict


def resolve_key_fields(
    schema: dict[str, Any], fallback: Sequence[str]
) -> tuple[str, ...]:
    declared = schema.get("partitionKey")
    if isinstance(declared, str):
        declared = [declared]
    if (
        isinstance(declared, list)
        and all(isinstance(f, str) for f in declared)
        and declared
    ):
        logger.info("partition key from schema contract: %s", ", ".join(declared))
        return tuple(declared)

    logger.info(
        "schema declares no partitionKey; using configured fallback: %s",
        ", ".join(fallback),
    )
    return tuple(fallback)


def extract_key(record: dict[str, Any], candidates: Sequence[str]) -> str | None:
    """Return the first non-null candidate field as the partition key."""
    for candidate in candidates:
        field = record.get(candidate)
        if field is not None:
            return str(field)
    return None


def produce_records(
    producer: KafkaProducer,
    serializer: AvroSerializer,
    topic: str,
    records: Iterable[dict[str, Any]],
    key_fields: Sequence[str],
    static_headers: Mapping[str, str] | None = None,
    on_progress: Callable[[int, dict[str, Any]], None] | None = None,
) -> ProducerStats:
    """Produces an iterable of records to the specified topic.

    Headers carry transport metadata readable without deserializing the value:
    `static_headers` (e.g. producer identity) go on every message, and a fresh
    x-correlation-id is minted per message for cross-service tracing/DLQ
    diagnostics. Business data stays in the schema'd payload.
    """

    serializer_context = SerializationContext(topic, MessageField.VALUE)

    produced = 0
    errors = 0
    undelivered = 0
    start_time = time.monotonic()

    try:
        for i, record in enumerate(records):
            value = serializer(record, serializer_context)
            key = extract_key(record, key_fields)

            headers = {**(static_headers or {}), "x-correlation-id": str(uuid.uuid4())}

            try:
                producer.produce(
                    topic=topic,
                    value=value,
                    key=key,
                    callback=_kafka_delivery_callback,
                    headers=headers,
                )
                produced += 1
            except BufferError:
                # Local send queue full: drain it, then retry once
                producer.flush(timeout=5)
                producer.produce(
                    topic=topic,
                    value=value,
                    key=key,
                    callback=_kafka_delivery_callback,
                    headers=headers,
                )
                produced += 1
            except KafkaException:
                errors += 1
                logger.exception("failed to produce record %d", i)

            # Serve delivery callbacks for previously sent messages
            producer.poll(0)

            if on_progress is not None:
                on_progress(i, record)

    except KeyboardInterrupt:
        logger.info("interrupted, flushing outstanding messages")
    finally:
        undelivered = producer.flush(timeout=30)

    return ProducerStats(
        produced=produced,
        errors=errors,
        undelivered=undelivered,
        elapsed_s=round(time.monotonic() - start_time, 1),
    )
