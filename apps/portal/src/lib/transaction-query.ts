import { buildPeriod, readPeriodMonths } from "./periods.ts";
import { buildMonthWindow } from "./summary.ts";

// The transactions page keeps everything in its URL, so a view can be linked. Two kinds of
// parameter live there:
// - filters (period or month, type, category, direction, order, page size): changing one
//   starts a new walk through the list
// - a walk's own state (cursor, page, and the window its first page was read with)

const PAGE_SIZES = ["10", "25", "50"];

const FILTER_NAMES = [
	"months",
	"month",
	"transactionType",
	"category",
	"creditDebitIndicator",
	"sort",
	"limit"
];

const WALK_NAMES = ["cursor", "page", "from", "to"];

const PASSED_THROUGH_NAMES = [
	"transactionType",
	"category",
	"creditDebitIndicator",
	"sort",
	"cursor"
];

export function readPageSize(value: string | null) {
	for (const size of PAGE_SIZES) {
		if (size === value) return size;
	}
	return "10";
}

export function readPageNumber(value: string | null) {
	const page = Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

// A month bucket as the overview's chart names it: "2026-08"
export function readMonth(value: string | null) {
	if (value === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
		return undefined;
	return value;
}

// The window a page reads. A walk keeps the exact window its first page was read with, the way
// the API's own next/prev links do, so the pages never shift under it. A fresh list reads the
// chosen month, or else the period up to now.
function buildListWindow(searchParams: URLSearchParams, now: Date) {
	const from = searchParams.get("from");
	const to = searchParams.get("to");
	if (from !== null && to !== null)
		return { fromDateTime: from, toDateTime: to };
	const month = readMonth(searchParams.get("month"));
	if (month !== undefined) return buildMonthWindow(month);
	return buildPeriod(readPeriodMonths(searchParams.get("months")), now);
}

export function buildListQuery(searchParams: URLSearchParams, now: Date) {
	const query = new URLSearchParams(buildListWindow(searchParams, now));
	for (const name of PASSED_THROUGH_NAMES) {
		const value = searchParams.get(name);
		if (value !== null && value !== "") query.set(name, value);
	}
	query.set("limit", readPageSize(searchParams.get("limit")));
	return query;
}

// What the period filter shows: the chosen month, or else the number of months
export function readPeriodValue(searchParams: URLSearchParams) {
	return (
		readMonth(searchParams.get("month")) ??
		String(readPeriodMonths(searchParams.get("months")))
	);
}

// A filter change starts a new walk. Choosing a period replaces a chosen month.
export function buildFilterHref(
	searchParams: URLSearchParams,
	name: string,
	value: string
) {
	const next = new URLSearchParams(searchParams);
	for (const walkName of WALK_NAMES) {
		next.delete(walkName);
	}
	if (name === "months") next.delete("month");
	if (value === "") next.delete(name);
	else next.set(name, value);
	return `/transactions?${next}`;
}

export function buildFirstPageHref(searchParams: URLSearchParams) {
	const next = new URLSearchParams(searchParams);
	for (const walkName of WALK_NAMES) {
		next.delete(walkName);
	}
	return `/transactions?${next}`;
}

export function buildPageHref(
	searchParams: URLSearchParams,
	cursor: string,
	page: number,
	listWindow: { fromDateTime: string; toDateTime: string }
) {
	const next = new URLSearchParams(searchParams);
	next.set("cursor", cursor);
	next.set("page", String(page));
	next.set("from", listWindow.fromDateTime);
	next.set("to", listWindow.toDateTime);
	return `/transactions?${next}`;
}

export function hasFilters(searchParams: URLSearchParams) {
	for (const name of FILTER_NAMES) {
		if (searchParams.has(name)) return true;
	}
	return false;
}

// The overview's spending bars are money out, so their list is too
export function buildSpendingHref(category: string, months: number) {
	const query = new URLSearchParams({
		category,
		months: String(months),
		creditDebitIndicator: "debit"
	});
	return `/transactions?${query}`;
}

export function buildMonthHref(month: string) {
	return `/transactions?${new URLSearchParams({ month })}`;
}
