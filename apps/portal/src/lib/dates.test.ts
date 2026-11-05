import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTransactionDate, formatTransactionDateTime } from "./dates.ts";

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

test("shows a transaction's date and time in South African time", () => {
	assert.equal(
		formatTransactionDateTime("2026-08-26T09:41:34.964Z"),
		"26 Aug 2026, 11:41"
	);
	assert.equal(
		formatTransactionDateTime("2026-08-14T22:00:00.000Z"),
		"15 Aug 2026, 00:00"
	);
});
