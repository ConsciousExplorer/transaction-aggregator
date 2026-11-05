import assert from "node:assert/strict";
import { test } from "node:test";
import {
	describeRowAmount,
	describeRowAverage,
	describeRowSubline,
	isMoneyInOnly
} from "./spending-text.ts";

// Intl separates groups with non-breaking spaces; compare with ordinary ones
function normaliseSpaces(text: string) {
	return text.replace(/\s/g, " ");
}

test("a row with no transactions reads nothing in this period", () => {
	assert.equal(describeRowSubline(0, 0, 10000), "nothing in this period");
});

test("a row reads its count and its share of the period's money out", () => {
	assert.equal(describeRowSubline(3, 600, 10000), "3 transactions · 6%");
});

test("a row with one transaction reads it in the singular", () => {
	assert.equal(describeRowSubline(1, 5000, 10000), "1 transaction · 50%");
});

test("a share that rounds to nothing while money went out reads under one percent", () => {
	// The seeded Subscriptions row over 12 months: one transaction of R 970,30, of R 236 065,56
	// money out
	assert.equal(describeRowSubline(1, 97030, 23606556), "1 transaction · <1%");
});

test("a row with transactions but no money out reads its count and no share", () => {
	assert.equal(describeRowSubline(2, 0, 23606556), "2 transactions");
});

test("a row is money in only when it received money and sent none", () => {
	assert.equal(isMoneyInOnly(0, 885729), true);
	assert.equal(isMoneyInOnly(97030, 0), false);
	assert.equal(isMoneyInOnly(97030, 885729), false);
	assert.equal(isMoneyInOnly(0, 0), false);
});

test("a row with only money in shows that money with its plus", () => {
	assert.equal(
		normaliseSpaces(describeRowAmount(0, 885729, "ZAR")),
		"+R 8 857,29"
	);
});

test("a row that sent money shows its money out, whatever it received", () => {
	assert.equal(normaliseSpaces(describeRowAmount(97030, 0, "ZAR")), "R 970,30");
	assert.equal(
		normaliseSpaces(describeRowAmount(97030, 885729, "ZAR")),
		"R 970,30"
	);
});

test("a row with no money either way shows a plain zero", () => {
	assert.equal(normaliseSpaces(describeRowAmount(0, 0, "ZAR")), "R 0,00");
});

test("a row with nothing out has no average", () => {
	assert.equal(describeRowAverage(0, 0, "ZAR"), undefined);
});

test("a row's average is its money out per transaction out, in whole rand", () => {
	assert.equal(
		normaliseSpaces(describeRowAverage(4834000, 2, "ZAR") ?? ""),
		"R 24 170 avg"
	);
});
