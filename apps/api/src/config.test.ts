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
		const config = loadConfig({ LOG_REDACTED_FIELDS: " iban, accountNumber,," });

		assert.deepStrictEqual(config.logging.redactedFields, [
			"iban",
			"accountNumber"
		]);
	});

	test("LOG_REDACT_DEPTH must be a positive whole number", () => {
		assert.equal(loadConfig({ LOG_REDACT_DEPTH: "5" }).logging.redactDepth, 5);
		assert.throws(() => loadConfig({ LOG_REDACT_DEPTH: "0" }), /LOG_REDACT_DEPTH/);
	});
});

suite("DATABASE_QUERY_LOG", () => {
	test("is off unless set", () => {
		assert.equal(loadConfig({}).database.queryLog, "off");
	});

	test("can log plans", () => {
		const config = loadConfig({ DATABASE_QUERY_LOG: "plan" });

		assert.equal(config.database.queryLog, "plan");
	});
});
