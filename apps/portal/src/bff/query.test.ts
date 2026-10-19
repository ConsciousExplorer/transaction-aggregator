import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApiQuery } from "./query.ts";

test("keeps only the allowed, non-empty parameters", () => {
	const source = new URLSearchParams(
		"limit=10&userId=someone-else&category=&sort=occurredAt"
	);
	assert.equal(
		buildApiQuery(source, ["limit", "category", "sort"]).toString(),
		"limit=10&sort=occurredAt"
	);
});

test("keeps every value of a repeated parameter", () => {
	const source = new URLSearchParams(
		"transactionType=card&transactionType=eft"
	);
	assert.equal(
		buildApiQuery(source, ["transactionType"]).toString(),
		"transactionType=card&transactionType=eft"
	);
});
