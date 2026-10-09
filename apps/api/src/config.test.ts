import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { loadConfig } from "./config.ts";

suite("DATABASE_QUERY_LOG", () => {
	test("is off unless set", () => {
		assert.equal(loadConfig({}).database.queryLog, "off");
	});

	test("can log plans", () => {
		const config = loadConfig({ DATABASE_QUERY_LOG: "plan" });

		assert.equal(config.database.queryLog, "plan");
	});
});
