import assert from "node:assert";
import { suite, test } from "node:test";
import { loadConfig } from "#src/config.ts";

const sampleEnv: Record<string, string | undefined> = {
	// # NODE and APP configuration
	NODE_ENV: "production",
	APP_NAME: "transaction-aggregator",
	HOST: "0.0.0.0",
	PORT: "6000",

	// # Secrets and certs
	SECRETS_DIR: "./secrets",

	// # Logging configuration
	LOG_LEVEL: "info",
	LOG_FORMAT: "json",
	LOG_PRETTY: "false",

	// # Postgres configuration
	DATABASE_HOST: "localhost",
	DATABASE_NAME: "txn_agg",
	DATABASE_PORT: "5432",
	DATABASE_USER: "kafka_consumer",
	DATABASE_PASSWORD: "kafka_consumer_password",
	DATABASE_POOL_MIN: "2",
	DATABASE_POOL_MAX: "10",
	DATABASE_IDLE_TIMEOUT: "30000",
	DATABASE_CONNECTION_TIMEOUT: "5000",

	// # Schema Registry configuration
	SCHEMA_REGISTRY_URL: "http://localhost:8081",

	// # KAFKA configuration
	KAFKA_BROKERS: "localhost:9092",
	KAFKA_USERNAME: "consumer",
	KAFKA_PASSWORD: "consumer-password",
	KAFKA_SASL_MECHANISM: "SCRAM-SHA-512",
	KAFKA_GROUP_ID: "transaction-aggregator-group",
	KAFKA_TOPICS: "transactions.card"
};

suite("loadConfig", () => {
	test("config loads correctly when all values are loaded", () => {
		const config = loadConfig(sampleEnv);
		assert.strictEqual(config.database.user, "kafka_consumer");
	});

	test("should fail validation required vars are not passed", () => {
		const { DATABASE_USER, KAFKA_USER, ...rest } = sampleEnv;
		assert.throws(() => loadConfig(rest), {
			name: "Error"
		});
	});

	test("redaction settings fall back to defaults when unset", () => {
		const config = loadConfig(sampleEnv);
		assert.deepStrictEqual(config.logging.redactedFields, []);
		assert.strictEqual(config.logging.redactDepth, 3);
	});

	test("LOG_REDACTED_FIELDS splits on commas and drops blanks", () => {
		const config = loadConfig({
			...sampleEnv,
			LOG_REDACTED_FIELDS: " cardNumber, iban ,, ssn "
		});
		assert.deepStrictEqual(config.logging.redactedFields, [
			"cardNumber",
			"iban",
			"ssn"
		]);
	});

	test("LOG_REDACT_DEPTH must be a positive integer", () => {
		assert.strictEqual(
			loadConfig({ ...sampleEnv, LOG_REDACT_DEPTH: "5" }).logging.redactDepth,
			5
		);
		assert.throws(() => loadConfig({ ...sampleEnv, LOG_REDACT_DEPTH: "0" }));
	});
});
