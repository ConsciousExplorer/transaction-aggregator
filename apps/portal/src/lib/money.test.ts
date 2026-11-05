import assert from "node:assert/strict";
import { test } from "node:test";
import {
	describeTransactionCount,
	formatAxisMoney,
	formatAxisMoneyCompact,
	formatCount,
	formatMoney,
	formatNetAmount,
	formatSignedMoney,
	formatWholeMoney,
	splitAtCents
} from "./money.ts";

// Intl separates groups with non-breaking spaces; compare with ordinary ones
function normaliseSpaces(text: string) {
	return text.replace(/\s/g, " ");
}

test("formats minor units as rand", () => {
	assert.equal(normaliseSpaces(formatMoney(123456, "ZAR")), "R 1 234,56");
	assert.equal(normaliseSpaces(formatMoney(5, "ZAR")), "R 0,05");
});

test("groups a count the way the amounts are grouped", () => {
	assert.equal(normaliseSpaces(formatCount(12345)), "12 345");
	assert.equal(formatCount(27), "27");
	assert.equal(formatCount(0), "0");
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

test("counts transactions with a singular noun for one", () => {
	assert.equal(describeTransactionCount(1), "1 transaction");
	assert.equal(describeTransactionCount(2), "2 transactions");
	assert.equal(
		normaliseSpaces(describeTransactionCount(12345)),
		"12 345 transactions"
	);
});

test("signs the net by which way more money went, and not at all at zero", () => {
	assert.equal(
		normaliseSpaces(formatNetAmount({ amountMinor: 0, currency: "ZAR" })),
		"R 0,00"
	);
	assert.equal(
		normaliseSpaces(formatNetAmount({ amountMinor: -81240, currency: "ZAR" })),
		"−R 812,40"
	);
	assert.equal(
		normaliseSpaces(formatNetAmount({ amountMinor: 81240, currency: "ZAR" })),
		"+R 812,40"
	);
});

test("formats an average as whole rand, rounding the cents", () => {
	assert.equal(normaliseSpaces(formatWholeMoney(2417019, "ZAR")), "R 24 170");
	assert.equal(normaliseSpaces(formatWholeMoney(1967213, "ZAR")), "R 19 672");
	assert.equal(normaliseSpaces(formatWholeMoney(0, "ZAR")), "R 0");
});

// Each part with its spaces normalised, so the parts can be compared as written
function splitAtCentsReadably(formatted: string) {
	const parts = splitAtCents(formatted);
	return {
		whole: normaliseSpaces(parts.whole),
		cents: normaliseSpaces(parts.cents)
	};
}

test("a total splits at the decimal comma into its rand and its cents", () => {
	assert.deepEqual(splitAtCentsReadably(formatMoney(23606556, "ZAR")), {
		whole: "R 236 065",
		cents: ",56"
	});
});

test("a whole-rand total keeps its zero cents, and money with no comma is all rand", () => {
	assert.deepEqual(splitAtCentsReadably(formatMoney(100000, "ZAR")), {
		whole: "R 1 000",
		cents: ",00"
	});
	assert.deepEqual(splitAtCentsReadably(formatWholeMoney(100000, "ZAR")), {
		whole: "R 1 000",
		cents: ""
	});
});

test("a negative amount keeps its sign with the rand", () => {
	assert.deepEqual(splitAtCentsReadably(formatMoney(-81240, "ZAR")), {
		whole: "-R 812",
		cents: ",40"
	});
});

test("formats an axis label as whole rand, with a true minus below zero", () => {
	assert.equal(normaliseSpaces(formatAxisMoney(0)), "R 0");
	assert.equal(normaliseSpaces(formatAxisMoney(2500000)), "R 25 000");
	assert.equal(normaliseSpaces(formatAxisMoney(-20000000)), "−R 200 000");
});

test("compacts an axis label to thousands or millions for a phone", () => {
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(0)), "R 0");
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(50000)), "R 500");
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(40000000)), "R 400 k");
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(250000)), "R 2,5 k");
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(-2500000)), "−R 25 k");
	assert.equal(normaliseSpaces(formatAxisMoneyCompact(-100000000)), "−R 1,0 m");
});
