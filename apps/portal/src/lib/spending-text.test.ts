import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRowAverage, describeRowSubline } from "./spending-text.ts";

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

test("a row with transactions but no money out reads a share of zero", () => {
	assert.equal(describeRowSubline(2, 0, 23606556), "2 transactions · 0%");
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
