import type {
	SummaryRepository,
	UserSummaryFilter
} from "#src/integrations/database/repositories/summary-repository.ts";

type SummaryRow = Awaited<
	ReturnType<SummaryRepository["getUserSummary"]>
>[number];

function buildAmount(amountMinor: number, currency: string) {
	return { amountMinor, currency };
}

export function buildSummaryItem(
	row: SummaryRow,
	interval: UserSummaryFilter["interval"]
) {
	return {
		group: {
			category: row.category,
			day: interval === "day" ? row.bucketStart : undefined,
			week: interval === "week" ? row.bucketStart : undefined,
			month: interval === "month" ? row.bucketStart : undefined
		},
		count: row.count,
		netAmount: buildAmount(row.creditAmount - row.debitAmount, row.currency),
		debit: {
			count: row.debitCount,
			total: buildAmount(row.debitAmount, row.currency)
		},
		credit: {
			count: row.creditCount,
			total: buildAmount(row.creditAmount, row.currency)
		}
	};
}

/** Grand totals over all rows. */
export function sumTotals(rows: SummaryRow[]) {
	// The database holds one currency; an empty window has no row to read it from
	const currency = rows[0]?.currency ?? "ZAR";

	let transactionCount = 0;
	let debitCount = 0;
	let debitTotal = 0;
	let creditCount = 0;
	let creditTotal = 0;

	for (const row of rows) {
		transactionCount += row.count;
		debitCount += row.debitCount;
		debitTotal += row.debitAmount;
		creditCount += row.creditCount;
		creditTotal += row.creditAmount;
	}

	return {
		transactionCount,
		netAmount: buildAmount(creditTotal - debitTotal, currency),
		debit: { count: debitCount, total: buildAmount(debitTotal, currency) },
		credit: { count: creditCount, total: buildAmount(creditTotal, currency) }
	};
}
