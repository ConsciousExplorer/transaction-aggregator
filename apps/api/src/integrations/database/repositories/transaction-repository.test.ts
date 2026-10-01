import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { readsAscending } from "./transaction-repository.ts";

suite("readsAscending", () => {
	test("newest first: next reads downwards, prev reads upwards", () => {
		assert.strictEqual(readsAscending("-occurredAt", "next"), false);
		assert.strictEqual(readsAscending("-occurredAt", "prev"), true);
	});

	test("oldest first: next reads upwards, prev reads downwards", () => {
		assert.strictEqual(readsAscending("occurredAt", "next"), true);
		assert.strictEqual(readsAscending("occurredAt", "prev"), false);
	});
});
