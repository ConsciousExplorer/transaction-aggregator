import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from avro_datagen import generate, load_schema
from confluent_kafka.schema_registry import Schema, SchemaRegistryClient
from confluent_kafka.schema_registry.error import SchemaRegistryError
from confluent_kafka.serialization import MessageField, SerializationContext

from producer_core import build_serializer, strip_generator_annotations

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
VERSION_1 = SCHEMAS / "card.avsc"
VERSION_2 = SCHEMAS / "v2" / "card.avsc"

TOPIC = "transactions.card"
SUBJECT = f"{TOPIC}-value"
ANCHOR = datetime(2026, 10, 4, tzinfo=UTC)


def build_registry() -> SchemaRegistryClient:
    """The client library's own in-memory registry: no network, real lookups."""
    return SchemaRegistryClient.new_client({"url": "mock://"})


def register_schema_file(registry: SchemaRegistryClient, path: Path) -> int:
    """Registers a schema file the way schemas-register does; returns its id."""
    schema_text = json.dumps(strip_generator_annotations(load_schema(path)))
    return registry.register_schema(SUBJECT, Schema(schema_text, "AVRO"))


def read_schema_id(value: bytes) -> int:
    """Confluent wire format: a magic byte, then the schema id as an int32."""
    return int.from_bytes(value[1:5], "big")


def test_generator_hints_are_stripped_and_the_partition_key_is_kept():
    schema = strip_generator_annotations(load_schema(VERSION_1))

    assert "arg.properties" not in json.dumps(schema)
    assert schema["partitionKey"] == "customerId"


def test_a_producer_on_the_older_file_writes_the_older_version():
    registry = build_registry()
    version_1_id = register_schema_file(registry, VERSION_1)
    version_2_id = register_schema_file(registry, VERSION_2)
    [record] = generate(VERSION_1, 1, seed=1, now=ANCHOR)

    serializer, _ = build_serializer(registry, SUBJECT, VERSION_1)
    value = serializer(record, SerializationContext(TOPIC, MessageField.VALUE))

    assert version_1_id != version_2_id
    assert value is not None
    assert read_schema_id(value) == version_1_id


def test_a_schema_that_was_never_registered_stops_the_producer():
    registry = build_registry()
    register_schema_file(registry, VERSION_1)

    with pytest.raises(SchemaRegistryError):
        build_serializer(registry, SUBJECT, VERSION_2)
