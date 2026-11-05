import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFinding, describeFindingWindow } from "./finding.ts";
import type { Summary } from "./types.ts";

function buildTotals(
	transactionCount: number,
	moneyOutMinor: number
): Summary["totals"] {
	return {
		transactionCount,
		credit: { count: 0, total: { amountMinor: 0, currency: "ZAR" } },
		debit: {
			count: transactionCount,
			total: { amountMinor: moneyOutMinor, currency: "ZAR" }
		},
		netAmount: { amountMinor: -moneyOutMinor, currency: "ZAR" }
	};
}

// Intl separates groups with non-breaking spaces; compare with ordinary ones
function normaliseSpaces(text: string) {
	return text.replace(/\s/g, " ");
}

test("names the top category and its share of what went out in the period", () => {
	const finding = describeFinding(
		buildTotals(40, 1000000),
		[
			{ label: "Groceries", moneyOutMinor: 423000 },
			{ label: "Dining", moneyOutMinor: 100000 }
		],
		"in the last 3 months"
	);
	assert.equal(
		normaliseSpaces(finding),
		"Groceries took R 4 230,00, 42% of what went out in the last 3 months."
	);
});

test("names the top category's share in a selected bucket and rounds the share", () => {
	const finding = describeFinding(
		buildTotals(3, 30000),
		[{ label: "Fuel", moneyOutMinor: 20000 }],
		"in week 29, 13–19 Jul 2026"
	);
	assert.equal(
		normaliseSpaces(finding),
		"Fuel took R 200,00, 67% of what went out in week 29, 13–19 Jul 2026."
	);
});

test("says nothing went out when no money did, or no category has any", () => {
	assert.equal(
		describeFinding(
			buildTotals(5, 0),
			[{ label: "Pay", moneyOutMinor: 0 }],
			"in the last 12 months"
		),
		"Nothing went out in the last 12 months."
	);
	assert.equal(
		describeFinding(
			buildTotals(5, 1000),
			[{ label: "Pay", moneyOutMinor: 0 }],
			"in July 2026"
		),
		"Nothing went out in July 2026."
	);
});

test("says there were no completed transactions when there were none", () => {
	assert.equal(
		describeFinding(buildTotals(0, 0), [], "in the last month"),
		"No completed transactions in the last month."
	);
	assert.equal(
		describeFinding(buildTotals(0, 0), [], "in week 30, 20–26 Jul 2026"),
		"No completed transactions in week 30, 20–26 Jul 2026."
	);
});

test("labels the window as the period, a week or month, or a day", () => {
	assert.equal(
		describeFindingWindow(3, undefined, false),
		"in the last 3 months"
	);
	assert.equal(
		describeFindingWindow(3, "Week 29, 13–19 Jul 2026", false),
		"in week 29, 13–19 Jul 2026"
	);
	assert.equal(describeFindingWindow(12, "July 2026", false), "in July 2026");
	assert.equal(describeFindingWindow(1, "14 Jul 2026", true), "on 14 Jul 2026");
});

test("one month is the last month, not the last 1 month", () => {
	assert.equal(describeFindingWindow(1, undefined, false), "in the last month");
	assert.equal(
		describeFindingWindow(12, undefined, false),
		"in the last 12 months"
	);
});
