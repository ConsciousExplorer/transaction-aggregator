import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { loadConfig } from "./config.ts";

suite("DATABASE_QUERY_LOG", () => {
	test("is off unless set", () => {
		assert.equal(loadConfig({}).database.queryLog, "off");
	});

	test("can log plans in development", () => {
		const config = loadConfig({
			NODE_ENV: "development",
			DATABASE_QUERY_LOG: "plan"
		});

		assert.equal(config.database.queryLog, "plan");
	});

	test("is refused in production, where plans would re-run reads", () => {
		assert.throws(
			() => loadConfig({ NODE_ENV: "production", DATABASE_QUERY_LOG: "plan" }),
			/DATABASE_QUERY_LOG/
		);
	});

	test("is refused in test, where logged parameters are not wanted", () => {
		assert.throws(
			() => loadConfig({ NODE_ENV: "test", DATABASE_QUERY_LOG: "sql" }),
			/DATABASE_QUERY_LOG/
		);
	});
});
