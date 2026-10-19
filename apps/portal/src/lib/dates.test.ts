import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTransactionDate } from "./dates.ts";

test("shows a transaction's date in South African time", () => {
	assert.equal(
		formatTransactionDate("2026-08-26T09:41:34.964Z"),
		"26 Aug 2026"
	);
	// 23:30 UTC is already the next day in Johannesburg (UTC+2)
	assert.equal(
		formatTransactionDate("2026-08-25T23:30:00.000Z"),
		"26 Aug 2026"
	);
});
