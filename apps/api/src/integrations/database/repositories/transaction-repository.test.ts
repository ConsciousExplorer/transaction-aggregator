import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { chooseReadSort } from "./transaction-repository.ts";

suite("chooseReadSort", () => {
	test("a next page is read in the requested sort order", () => {
		assert.strictEqual(chooseReadSort("-occurredAt", "next"), "-occurredAt");
		assert.strictEqual(chooseReadSort("occurredAt", "next"), "occurredAt");
	});

	test("a prev page is read against the requested sort order", () => {
		assert.strictEqual(chooseReadSort("-occurredAt", "prev"), "occurredAt");
		assert.strictEqual(chooseReadSort("occurredAt", "prev"), "-occurredAt");
	});
});
