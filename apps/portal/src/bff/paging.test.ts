import assert from "node:assert/strict";
import { test } from "node:test";
import { readCursor } from "./paging.ts";

test("reads the cursor from a relative link", () => {
	assert.equal(readCursor("/api/v1/users/1/transactions?limit=10&cursor=abc_-1"), "abc_-1");
});

test("reads the cursor from an absolute link", () => {
	assert.equal(readCursor("http://api:8083/api/v1/users/1/transactions?cursor=xyz"), "xyz");
});

test("returns undefined when there is no link or no cursor", () => {
	assert.equal(readCursor(undefined), undefined);
	assert.equal(readCursor("/api/v1/users/1/transactions?limit=10"), undefined);
});
