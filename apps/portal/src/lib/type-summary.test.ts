import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildTypeRows,
	orderTypeRows,
	sumMoneyOutMinor
} from "./type-summary.ts";
import type { TransactionType, TypeSummaryRow } from "./types.ts";

// One side of a summary, money in or money out: how many times and how much
function buildSide(amountMinor: number, count: number) {
	return { count, total: { amountMinor, currency: "ZAR" } };
}

// One type's summary read: only its totals matter here. Its count is both sides together.
function buildSummaryBody(
	debitMinor: number,
	debitCount: number,
	creditMinor: number,
	creditCount: number
) {
	return {
		data: [],
		totals: {
			transactionCount: debitCount + creditCount,
			debit: buildSide(debitMinor, debitCount),
			credit: buildSide(creditMinor, creditCount),
			netAmount: { amountMinor: creditMinor - debitMinor, currency: "ZAR" }
		}
	};
}

function buildTypeRow(
	transactionType: TransactionType,
	debitMinor: number,
	debitCount: number,
	creditMinor: number,
	creditCount: number
) {
	return {
		transactionType,
		count: debitCount + creditCount,
		debit: buildSide(debitMinor, debitCount),
		credit: buildSide(creditMinor, creditCount),
		netAmount: { amountMinor: creditMinor - debitMinor, currency: "ZAR" }
	};
}

function listTransactionTypes(rows: TypeSummaryRow[]) {
	const transactionTypes = [];
	for (const row of rows) {
		transactionTypes.push(row.transactionType);
	}
	return transactionTypes;
}

test("each type's summary becomes that type's row, in the order the reads come", () => {
	const rows = buildTypeRows([
		{ transactionType: "card", body: buildSummaryBody(5000, 4, 0, 0) },
		{ transactionType: "eft", body: buildSummaryBody(2000, 1, 9000, 2) },
		{ transactionType: "debit_order", body: buildSummaryBody(1500, 3, 0, 0) },
		{
			transactionType: "internal_transfer",
			body: buildSummaryBody(0, 0, 300, 1)
		}
	]);
	assert.deepEqual(rows, [
		buildTypeRow("card", 5000, 4, 0, 0),
		buildTypeRow("eft", 2000, 1, 9000, 2),
		buildTypeRow("debit_order", 1500, 3, 0, 0),
		buildTypeRow("internal_transfer", 0, 0, 300, 1)
	]);
});

test("orders the types by money out, a type with none last, equal amounts by label", () => {
	const ordered = orderTypeRows([
		buildTypeRow("internal_transfer", 0, 0, 300, 1),
		buildTypeRow("card", 1500, 3, 0, 0),
		buildTypeRow("eft", 0, 0, 9000, 2),
		buildTypeRow("debit_order", 5000, 4, 0, 0)
	]);
	assert.deepEqual(listTransactionTypes(ordered), [
		"debit_order",
		"card",
		"eft",
		"internal_transfer"
	]);
});

test("a period with nothing in or out orders the types by label and sums to zero", () => {
	const rows = [
		buildTypeRow("internal_transfer", 0, 0, 0, 0),
		buildTypeRow("eft", 0, 0, 0, 0),
		buildTypeRow("card", 0, 0, 0, 0),
		buildTypeRow("debit_order", 0, 0, 0, 0)
	];
	assert.deepEqual(listTransactionTypes(orderTypeRows(rows)), [
		"card",
		"debit_order",
		"eft",
		"internal_transfer"
	]);
	assert.equal(sumMoneyOutMinor(rows), 0);
});

test("the period's money out is every type's money out together", () => {
	const rows = [
		buildTypeRow("card", 5000, 4, 0, 0),
		buildTypeRow("eft", 2000, 1, 9000, 2),
		buildTypeRow("debit_order", 1500, 3, 0, 0),
		buildTypeRow("internal_transfer", 0, 0, 300, 1)
	];
	assert.equal(sumMoneyOutMinor(rows), 8500);
});
