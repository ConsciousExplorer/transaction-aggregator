"""D13 stamping: every emitted record carries a fresh eventId (UUIDv7) and
producedAt (emit epoch millis), and every message carries the envelope headers
(x-producer identity, fresh x-correlation-id) even when the caller supplies none.
"""

import time
import uuid

from producer_core import produce_records, uuid7


class FakeProducer:
    """Satisfies the KafkaProducer protocol; records every produce call."""

    def __init__(self):
        self.calls = []

    def produce(self, topic, value=None, key=None, *, callback=None, headers=None):
        self.calls.append({"topic": topic, "value": value, "key": key, "headers": headers})

    def poll(self, timeout: float) -> int:
        return 0

    def flush(self, timeout: float) -> int:
        return 0


def capturing_serializer(seen: list):
    """Stands in for AvroSerializer: records what it was asked to serialize."""

    def serialize(record, ctx):
        seen.append(dict(record))
        return b"bytes"

    return serialize


def test_uuid7_is_version_7_with_rfc_variant():
    value = uuid7()
    assert isinstance(value, uuid.UUID)
    assert value.version == 7
    assert value.variant == uuid.RFC_4122


def test_uuid7_high_bits_encode_current_unix_millis():
    before_ms = time.time_ns() // 1_000_000
    value = uuid7()
    after_ms = time.time_ns() // 1_000_000
    embedded_ms = value.int >> 80  # top 48 bits are the unix-ms timestamp
    assert before_ms <= embedded_ms <= after_ms


def test_produce_records_stamps_fresh_event_id_and_produced_at():
    seen = []
    producer = FakeProducer()
    before_ms = time.time_ns() // 1_000_000

    produce_records(
        producer,
        capturing_serializer(seen),
        "transactions.card",
        [{"customerId": "c-1"}, {"customerId": "c-2"}],
        key_fields=["customerId"],
    )

    after_ms = time.time_ns() // 1_000_000
    assert len(seen) == 2
    for record in seen:
        assert uuid.UUID(record["eventId"]).version == 7
        assert before_ms <= record["producedAt"] <= after_ms
    assert seen[0]["eventId"] != seen[1]["eventId"]


def test_produce_records_overwrites_generator_supplied_stamp_fields():
    # A re-emit (chaos duplicate) must get a FRESH delivery identity — stale
    # generator/datagen values must never survive to the wire (D06).
    seen = []
    produce_records(
        FakeProducer(),
        capturing_serializer(seen),
        "transactions.card",
        [{"customerId": "c-1", "eventId": "stale", "producedAt": 1}],
        key_fields=["customerId"],
    )

    assert seen[0]["eventId"] != "stale"
    assert seen[0]["producedAt"] > 1


def test_headers_include_producer_identity_and_fresh_correlation_id():
    producer = FakeProducer()

    produce_records(
        producer,
        capturing_serializer([]),
        "transactions.card",
        [{"customerId": "c-1"}, {"customerId": "c-2"}],
        key_fields=["customerId"],
    )

    first, second = (call["headers"] for call in producer.calls)
    assert first["x-producer"]  # identity present even with no static_headers
    assert first["x-correlation-id"] != second["x-correlation-id"]


def test_headers_keep_caller_supplied_producer_identity():
    producer = FakeProducer()

    produce_records(
        producer,
        capturing_serializer([]),
        "transactions.card",
        [{"customerId": "c-1"}],
        key_fields=["customerId"],
        static_headers={"x-producer": "producers/9.9.9"},
    )

    assert producer.calls[0]["headers"]["x-producer"] == "producers/9.9.9"
