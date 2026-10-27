import pytest
from pydantic import ValidationError

from config import KafkaSettings, ProducerSettings
from producer_core import extract_key, resolve_key_fields

REQUIRED_KAFKA_ENV = {
    "KAFKA_BROKERS": "kafka1:9094",
    "KAFKA_USERNAME": "producer",
    "KAFKA_PASSWORD": "secret",
    "KAFKA_TOPIC": "transactions.card",
}


def test_key_fields_default_to_customer_id(monkeypatch):
    for name, value in REQUIRED_KAFKA_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("KAFKA_KEY_FIELDS", raising=False)

    settings = KafkaSettings(_env_file=None)  # pyright: ignore[reportCallIssue]

    assert settings.key_fields == ["customerId"]


def test_a_schema_without_partition_key_is_keyed_by_customer_id():
    key_fields = resolve_key_fields({"type": "record"}, ["customerId"])

    assert key_fields == ("customerId",)
    assert extract_key({"customerId": "c-1", "userId": "u-1"}, key_fields) == "c-1"


def test_producer_name_is_required(monkeypatch):
    monkeypatch.delenv("PRODUCER_NAME", raising=False)

    with pytest.raises(ValidationError):
        ProducerSettings(_env_file=None)  # pyright: ignore[reportCallIssue]
