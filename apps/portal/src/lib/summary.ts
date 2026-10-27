import type { Category, SummaryRow } from "./types.ts";

export type MonthlyTotal = {
	month: string;
	moneyInMinor: number;
	moneyOutMinor: number;
};

export type CategorySpending = {
	category: string;
	label: string;
	amountMinor: number;
	count: number;
};

export function buildCategoryLabels(categories: Category[]) {
	const labels: Record<string, string> = {};
	for (const category of categories) {
		labels[category.category] = category.label;
	}
	return labels;
}

// With interval=month the summary has a row per month and category; the chart wants one per
// month. Sorted first, so each month's rows are adjacent and add onto the last entry.
export function buildMonthlyTotals(rows: SummaryRow[]) {
	const sorted = [...rows].sort((first, second) =>
		(first.group.month ?? "").localeCompare(second.group.month ?? "")
	);
	const totals: MonthlyTotal[] = [];
	for (const row of sorted) {
		const month = row.group.month ?? "";
		const last = totals[totals.length - 1];
		if (last !== undefined && last.month === month) {
			last.moneyInMinor += row.credit.total.amountMinor;
			last.moneyOutMinor += row.debit.total.amountMinor;
		} else {
			totals.push({
				month,
				moneyInMinor: row.credit.total.amountMinor,
				moneyOutMinor: row.debit.total.amountMinor
			});
		}
	}
	return totals;
}

function formatMonthKey(date: Date) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The API has no row for a month without transactions, and an axis that skips months reads as
// if none were missing. Buckets are UTC months, so the window is walked in UTC too.
export function fillMissingMonths(
	totals: MonthlyTotal[],
	fromDateTime: string,
	toDateTime: string
) {
	const from = new Date(fromDateTime);
	const month = new Date(
		Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)
	);
	const lastMonth = formatMonthKey(new Date(toDateTime));
	const filled: MonthlyTotal[] = [];
	for (
		;
		formatMonthKey(month) <= lastMonth;
		month.setUTCMonth(month.getUTCMonth() + 1)
	) {
		const key = formatMonthKey(month);
		filled.push(
			totals.find((total) => total.month === key) ?? {
				month: key,
				moneyInMinor: 0,
				moneyOutMinor: 0
			}
		);
	}
	return filled;
}

// Spending is the debit side. A category with none (salary, say) has no bar to draw.
export function buildCategorySpending(
	rows: SummaryRow[],
	labels: Record<string, string>
) {
	const spending: CategorySpending[] = [];
	for (const row of rows) {
		if (row.debit.total.amountMinor <= 0) continue;
		const category = row.group.category ?? "";
		spending.push({
			category,
			label: labels[category] ?? category,
			amountMinor: row.debit.total.amountMinor,
			count: row.debit.count
		});
	}
	spending.sort((first, second) => second.amountMinor - first.amountMinor);
	return spending;
}

// Month buckets arrive as "2025-11"
export function formatMonth(month: string, style: "short" | "long") {
	const date = new Date(`${month}-01T00:00:00Z`);
	const options: Intl.DateTimeFormatOptions =
		style === "short"
			? { month: "short", timeZone: "UTC" }
			: { month: "long", year: "numeric", timeZone: "UTC" };
	return new Intl.DateTimeFormat("en-ZA", options).format(date);
}

// The window a month bucket covers. The API buckets in UTC, and its toDateTime is exclusive,
// so the month runs from its first instant up to the next month's.
export function buildMonthWindow(month: string) {
	const from = new Date(`${month}-01T00:00:00.000Z`);
	const nextMonth = new Date(from);
	nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
	return {
		fromDateTime: from.toISOString(),
		toDateTime: nextMonth.toISOString()
	};
}
