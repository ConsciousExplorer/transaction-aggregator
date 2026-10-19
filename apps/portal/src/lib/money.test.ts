import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney, formatSignedMoney } from "./money.ts";

// Intl separates groups with non-breaking spaces; compare with ordinary ones
function normaliseSpaces(text: string) {
	return text.replace(/\s/g, " ");
}

test("formats minor units as rand", () => {
	assert.equal(normaliseSpaces(formatMoney(123456, "ZAR")), "R 1 234,56");
	assert.equal(normaliseSpaces(formatMoney(5, "ZAR")), "R 0,05");
});

test("signs money out with a minus and money in with a plus", () => {
	const amount = { amountMinor: 81240, currency: "ZAR" };
	assert.equal(
		normaliseSpaces(formatSignedMoney(amount, "debit")),
		"−R 812,40"
	);
	assert.equal(
		normaliseSpaces(formatSignedMoney(amount, "credit")),
		"+R 812,40"
	);
});
