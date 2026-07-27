from typing import Annotated, Literal

from pydantic import BaseModel, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore", frozen=True
    )

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO", validation_alias="LOG_LEVEL"
    )


class GeneratorSettings(BaseSettings):
    """Settings for the avro-datagen test-data generator."""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore", frozen=True
    )

    schema_path: str = Field(
        default="./schemas", validation_alias="GENERATOR_SCHEMA_PATH"
    )
    count: int = Field(default=500, ge=1, validation_alias="GENERATOR_COUNT")
    seed: int = Field(default=42, validation_alias="GENERATOR_SEED")


class schemaRegistrySettings(BaseSettings):
    """initialises the schema registry settings from the environment variables on startup."""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore", frozen=True
    )

    # Required environment variables
    url: str = Field(validation_alias="SCHEMA_REGISTRY_URL")
    schema_name: str = Field(validation_alias="SCHEMA_REGISTRY_SCHEMA_NAME")


class kafkaSettings(BaseSettings):
    """initialises the kafka settings from the environment variables on startup."""

    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore", frozen=True
    )

    # Required environment variables
    brokers: Annotated[list[str], NoDecode] = Field(
        validation_alias="KAFKA_BROKERS", min_length=1
    )
    username: str = Field(validation_alias="KAFKA_USERNAME")
    password: SecretStr = Field(validation_alias="KAFKA_PASSWORD")

    # Topic settings
    topic: str = Field(validation_alias="KAFKA_TOPIC")

    # Record fields that may hold the partition key, in priority order
    key_fields: Annotated[list[str], NoDecode] = Field(
        default=["userId", "user_id", "correlationId", "id", "key"],
        validation_alias="KAFKA_KEY_FIELDS",
        min_length=1,
    )

    # Fixed properties with default values
    security_protocol: Literal["PLAINTEXT", "SSL", "SASL_PLAINTEXT", "SASL_SSL"] = (
        Field(default="SASL_SSL", validation_alias="KAFKA_SECURITY_PROTOCOL")
    )
    sasl_mechanism: Literal["SCRAM-SHA-512", "SCRAM-SHA-256", "PLAIN"] = Field(
        default="SCRAM-SHA-512", validation_alias="KAFKA_SASL_MECHANISM"
    )
    acks: Literal["0", "1", "all"] = Field(default="all", validation_alias="KAFKA_ACKS")
    linger_ms: int = Field(
        default=5, ge=0, le=30_000, validation_alias="KAFKA_LINGER_MS"
    )
    enable_idempotence: bool = Field(
        default=True, validation_alias="ENABLE_IDEMPOTENCE"
    )

    @field_validator("brokers", "key_fields", mode="before")
    @classmethod
    def _split(cls, v: object) -> object:
        return (
            [h.strip() for h in v.split(",") if h.strip()] if isinstance(v, str) else v
        )

    def to_producer_config(self) -> dict[str, object]:
        """Returns a dictionary of the kafka settings for the producer"""
        return {
            "bootstrap.servers": ",".join(self.brokers),
            "sasl.username": self.username,
            "sasl.password": self.password.get_secret_value(),
            "security.protocol": self.security_protocol,
            "sasl.mechanisms": self.sasl_mechanism,
            "acks": self.acks,
            "linger.ms": self.linger_ms,
            "enable.idempotence": self.enable_idempotence,
        }


class AppConfig(BaseModel):
    """initialises the app settings from the environment variables on startup."""

    app: AppSettings
    kafka: kafkaSettings
    schemaRegistry: schemaRegistrySettings
    generator: GeneratorSettings


def get_config() -> AppConfig:
    """Returns the app settings from the environment variables"""
    return AppConfig(
        app=AppSettings(),
        kafka=kafkaSettings(),  # pyright: ignore[reportCallIssue]
        schemaRegistry=schemaRegistrySettings(),  # pyright: ignore[reportCallIssue]
        generator=GeneratorSettings(),
    )
