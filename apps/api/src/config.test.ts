import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { loadConfig } from "./config.ts";

suite("logging", () => {
	test("logs at info and redacts only the card number fields unless set", () => {
		assert.deepStrictEqual(loadConfig({}).logging, {
			level: "info",
			redactedFields: [],
			redactDepth: 3
		});
	});

	test("LOG_REDACTED_FIELDS is a comma-separated list of field names", () => {
		const config = loadConfig({
			LOG_REDACTED_FIELDS: " iban, accountNumber,,"
		});

		assert.deepStrictEqual(config.logging.redactedFields, [
			"iban",
			"accountNumber"
		]);
	});

	test("LOG_REDACT_DEPTH must be a positive whole number", () => {
		assert.equal(loadConfig({ LOG_REDACT_DEPTH: "5" }).logging.redactDepth, 5);
		assert.throws(
			() => loadConfig({ LOG_REDACT_DEPTH: "0" }),
			/LOG_REDACT_DEPTH/
		);
	});
});

suite("database pool", () => {
	// The server cancels first, so a lock wait fails as 57014 and the
	// client-side timeout is left for a connection that never answers
	test("by default the statement timeout fires before the query timeout", () => {
		const { database } = loadConfig({});
		assert.ok(database.statementTimeout < database.queryTimeout);
	});

	test("an environment value overrides a pool timeout's default", () => {
		const config = loadConfig({
			DATABASE_IDLE_TIMEOUT_MS: "5000",
			DATABASE_CONNECTION_TIMEOUT_MS: "2000"
		});

		assert.strictEqual(config.database.idleTimeout, 5000);
		assert.strictEqual(config.database.connectionTimeout, 2000);
	});
});

suite("query logging", () => {
	test("logs nothing unless set", () => {
		assert.deepStrictEqual(loadConfig({}).database.queryLog, {
			sql: false,
			plan: false
		});
	});

	test("sql and plan each turn on by themselves", () => {
		const config = loadConfig({ DATABASE_QUERY_LOG_PLAN: "true" });

		assert.deepStrictEqual(config.database.queryLog, {
			sql: false,
			plan: true
		});
	});
});
