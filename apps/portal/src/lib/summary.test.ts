import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildCategoryLabels,
	buildCategorySpending,
	buildMonthlyTotals,
	buildMonthWindow,
	fillMissingMonths,
	formatMonth
} from "./summary.ts";
import type { SummaryRow } from "./types.ts";

function buildSummaryRow(
	group: SummaryRow["group"],
	debitMinor: number,
	creditMinor: number
) {
	return {
		group,
		count: 1,
		debit: {
			count: debitMinor > 0 ? 1 : 0,
			total: { amountMinor: debitMinor, currency: "ZAR" }
		},
		credit: {
			count: creditMinor > 0 ? 1 : 0,
			total: { amountMinor: creditMinor, currency: "ZAR" }
		},
		netAmount: { amountMinor: creditMinor - debitMinor, currency: "ZAR" }
	};
}

test("adds every category's money in and out per month, oldest month first", () => {
	const rows = [
		buildSummaryRow({ category: "groceries", month: "2025-12" }, 100, 0),
		buildSummaryRow({ category: "salary", month: "2025-11" }, 0, 500),
		buildSummaryRow({ category: "dining", month: "2025-12" }, 50, 0)
	];
	assert.deepEqual(buildMonthlyTotals(rows), [
		{ month: "2025-11", moneyInMinor: 500, moneyOutMinor: 0 },
		{ month: "2025-12", moneyInMinor: 0, moneyOutMinor: 150 }
	]);
});

test("has no months when there are no rows", () => {
	assert.deepEqual(buildMonthlyTotals([]), []);
});

test("lists spending by category, largest first, leaving out categories with no spending", () => {
	const rows = [
		buildSummaryRow({ category: "groceries" }, 300, 0),
		buildSummaryRow({ category: "salary" }, 0, 1000),
		buildSummaryRow({ category: "dining" }, 500, 0)
	];
	const labels = buildCategoryLabels([
		{ categoryId: 1, category: "groceries", label: "Groceries" },
		{ categoryId: 2, category: "dining", label: "Dining out" }
	]);
	assert.deepEqual(buildCategorySpending(rows, labels), [
		{ category: "dining", label: "Dining out", amountMinor: 500, count: 1 },
		{ category: "groceries", label: "Groceries", amountMinor: 300, count: 1 }
	]);
});

test("falls back to the category's slug when it has no label", () => {
	const spending = buildCategorySpending(
		[buildSummaryRow({ category: "mystery" }, 10, 0)],
		{}
	);
	assert.equal(spending[0]?.label, "mystery");
});

test("puts every month of the window on the axis, empty ones at zero", () => {
	const totals = [{ month: "2025-11", moneyInMinor: 500, moneyOutMinor: 150 }];
	assert.deepEqual(
		fillMissingMonths(
			totals,
			"2025-10-19T08:00:00.000Z",
			"2026-01-05T08:00:00.000Z"
		),
		[
			{ month: "2025-10", moneyInMinor: 0, moneyOutMinor: 0 },
			{ month: "2025-11", moneyInMinor: 500, moneyOutMinor: 150 },
			{ month: "2025-12", moneyInMinor: 0, moneyOutMinor: 0 },
			{ month: "2026-01", moneyInMinor: 0, moneyOutMinor: 0 }
		]
	);
});

test("gives a month bucket's window in UTC, up to the next month's start (the API's toDateTime is exclusive)", () => {
	assert.deepEqual(buildMonthWindow("2025-11"), {
		fromDateTime: "2025-11-01T00:00:00.000Z",
		toDateTime: "2025-12-01T00:00:00.000Z"
	});
	assert.deepEqual(buildMonthWindow("2025-12"), {
		fromDateTime: "2025-12-01T00:00:00.000Z",
		toDateTime: "2026-01-01T00:00:00.000Z"
	});
});

test("formats a month bucket short for an axis and long for a tooltip", () => {
	assert.equal(formatMonth("2025-11", "short"), "Nov");
	assert.equal(formatMonth("2025-11", "long"), "November 2025");
});
