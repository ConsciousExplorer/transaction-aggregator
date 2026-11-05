import { TRANSACTION_TYPE_LABELS } from "./labels.ts";
import type { Summary, TransactionType, TypeSummaryRow } from "./types.ts";

// The spending card's Type tab: the window's totals for each transaction type. The BFF reads
// one summary per type, in this order, and answers one row per type in the same order.

export const TRANSACTION_TYPES: TransactionType[] = [
	"card",
	"eft",
	"debit_order",
	"internal_transfer"
];

// One type's summary read, carried with the type it was read for
type TypeSummaryRead = {
	transactionType: TransactionType;
	body: Summary;
};

// Each read's totals are its type's row, in the order the reads come
export function buildTypeRows(reads: TypeSummaryRead[]) {
	const rows: TypeSummaryRow[] = [];
	for (const read of reads) {
		rows.push({
			transactionType: read.transactionType,
			count: read.body.totals.transactionCount,
			credit: read.body.totals.credit,
			debit: read.body.totals.debit,
			netAmount: read.body.totals.netAmount
		});
	}
	return rows;
}

// Most money out first, so a type with none falls to the end; equal amounts go by label
export function orderTypeRows(rows: TypeSummaryRow[]) {
	const ordered = [...rows];
	ordered.sort((first, second) => {
		if (first.debit.total.amountMinor !== second.debit.total.amountMinor)
			return second.debit.total.amountMinor - first.debit.total.amountMinor;
		return TRANSACTION_TYPE_LABELS[first.transactionType].localeCompare(
			TRANSACTION_TYPE_LABELS[second.transactionType]
		);
	});
	return ordered;
}

// The money out of every type together, which each type's share is of. The rows cover every
// type whatever type the screen is filtered to, so the shares add up to the whole period.
export function sumMoneyOutMinor(rows: TypeSummaryRow[]) {
	let totalMinor = 0;
	for (const row of rows) {
		totalMinor += row.debit.total.amountMinor;
	}
	return totalMinor;
}
