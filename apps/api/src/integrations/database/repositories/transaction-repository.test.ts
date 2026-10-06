import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { isAscendingRead } from "./transaction-repository.ts";

suite("isAscendingRead", () => {
	test("newest first: next reads downwards, prev reads upwards", () => {
		assert.strictEqual(isAscendingRead("-occurredAt", "next"), false);
		assert.strictEqual(isAscendingRead("-occurredAt", "prev"), true);
	});

	test("oldest first: next reads upwards, prev reads downwards", () => {
		assert.strictEqual(isAscendingRead("occurredAt", "next"), true);
		assert.strictEqual(isAscendingRead("occurredAt", "prev"), false);
	});
});
