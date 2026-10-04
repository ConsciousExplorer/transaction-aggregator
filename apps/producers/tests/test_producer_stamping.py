import re
from typing import Any

from producer_core import produce_records

TRACEPARENT = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-01$")


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


def capturing_serializer(seen: list) -> Any:
    """Stands in for AvroSerializer: records what it was asked to serialize.
    Typed Any because produce_records only calls it, never AvroSerializer's API."""

    def serialize(record, ctx):
        seen.append(dict(record))
        return b"bytes"

    return serialize


def test_produce_records_serializes_the_record_without_stamping_it():
    seen = []
    record = {"customerId": "c-1", "amount": 100}

    produce_records(
        FakeProducer(),
        capturing_serializer(seen),
        "transactions.card",
        [dict(record)],
        key_fields=["customerId"],
    )

    assert seen == [record]


def test_headers_include_producer_identity_and_fresh_traceparent():
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
    assert TRACEPARENT.match(first["traceparent"])
    assert TRACEPARENT.match(second["traceparent"])
    assert first["traceparent"] != second["traceparent"]


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
