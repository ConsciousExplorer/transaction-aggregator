import { convertRandToMinor, readRandAmount } from "./amounts.ts";
import { buildBucketWindow } from "./buckets.ts";
import { buildPeriod, type Interval, readPeriodMonths } from "./periods.ts";
import { isUsualShown, USUAL_WINDOW_MONTHS } from "./usual.ts";

// The one screen keeps everything in its URL, so a view can be linked. Three kinds of
// parameter live there:
// - the period (`months`) and the bucket size (`interval`)
// - filters and selections: a selected `bucket` and `category` cross-filter the blocks, and
//   `transactionType`, `creditDebitIndicator` and the amount range narrow all of them
// - list settings (`sort`, `limit`) and `open`, the transaction whose detail is open
// Every href here is a link on that screen.

// The page sizes the URL's `limit` may name; any other reads as 10
const PAGE_SIZES = ["10", "25", "50", "100"];

// What "Clear all" removes and what `hasFilters` reports
const FILTER_NAMES = [
	"bucket",
	"category",
	"transactionType",
	"creditDebitIndicator",
	"amountMin",
	"amountMax"
];

const PASSED_THROUGH_NAMES = ["transactionType", "creditDebitIndicator"];

const AMOUNT_NAMES = ["amountMin", "amountMax"];

export function readPageSize(value: string | null) {
	for (const size of PAGE_SIZES) {
		if (size === value) return size;
	}
	return "10";
}

// Copies a named parameter onto the query when it is set and not empty
function copyParameter(
	searchParams: URLSearchParams,
	query: URLSearchParams,
	name: string
) {
	const value = searchParams.get(name);
	if (value !== null && value !== "") query.set(name, value);
}

// The type, direction and amount range every block honours, with the amount in minor units.
// Category is left out: the figures ignore it and the chart and list add it themselves.
function addSharedFilters(
	searchParams: URLSearchParams,
	query: URLSearchParams
) {
	for (const name of PASSED_THROUGH_NAMES) {
		copyParameter(searchParams, query, name);
	}
	for (const name of AMOUNT_NAMES) {
		const rand = readRandAmount(searchParams.get(name));
		if (rand !== undefined) query.set(name, String(convertRandToMinor(rand)));
	}
}

function buildPeriodWindow(searchParams: URLSearchParams, now: Date) {
	return buildPeriod(readPeriodMonths(searchParams.get("months")), now);
}

// The window the list and figures read: the period, or the selected bucket clipped to it.
// The first bucket starts before the period does, and the chart only counts it from the
// period's start, so a selected bucket must read the same span its bar shows.
export function buildSelectedWindow(
	searchParams: URLSearchParams,
	now: Date,
	selectedBucket: string | undefined
) {
	const period = buildPeriodWindow(searchParams, now);
	if (selectedBucket === undefined) return period;
	const bucket = buildBucketWindow(selectedBucket);
	const fromDateTime =
		bucket.fromDateTime > period.fromDateTime
			? bucket.fromDateTime
			: period.fromDateTime;
	const toDateTime =
		bucket.toDateTime < period.toDateTime
			? bucket.toDateTime
			: period.toDateTime;
	return { fromDateTime, toDateTime };
}

// The list honours everything: the selected bucket's window, else the period up to now
export function buildListQuery(
	searchParams: URLSearchParams,
	now: Date,
	selectedBucket: string | undefined,
	cursor?: string
) {
	const selectedWindow = buildSelectedWindow(searchParams, now, selectedBucket);
	const query = new URLSearchParams(selectedWindow);
	addSharedFilters(searchParams, query);
	copyParameter(searchParams, query, "category");
	copyParameter(searchParams, query, "sort");
	query.set("limit", readPageSize(searchParams.get("limit")));
	if (cursor !== undefined) query.set("cursor", cursor);
	return query;
}

// The category figures and totals ignore the category selection, so every category stays
// on screen to be picked
export function buildFiguresQuery(
	searchParams: URLSearchParams,
	now: Date,
	selectedBucket: string | undefined
) {
	const selectedWindow = buildSelectedWindow(searchParams, now, selectedBucket);
	const query = new URLSearchParams(selectedWindow);
	addSharedFilters(searchParams, query);
	return query;
}

// The spending card's Type tab lists every transaction type whatever type the screen is
// filtered to, so it reads the figures' window and filters without the type
export function buildByTypeQuery(
	searchParams: URLSearchParams,
	now: Date,
	selectedBucket: string | undefined
) {
	const query = buildFiguresQuery(searchParams, now, selectedBucket);
	query.delete("transactionType");
	return query;
}

// A category's usual month is measured over the last 12 months, whatever period is shown, with
// the type, direction and amount filters every block honours. It reads every category, so the
// selected category and bucket are left out.
export function buildUsualQuery(searchParams: URLSearchParams, now: Date) {
	const query = new URLSearchParams(buildPeriod(USUAL_WINDOW_MONTHS, now));
	addSharedFilters(searchParams, query);
	return query;
}

// The chart ignores the bucket selection, so every bar stays on screen to be picked; it
// honours the category
export function buildChartQuery(
	searchParams: URLSearchParams,
	now: Date,
	interval: Interval
) {
	const query = new URLSearchParams(buildPeriodWindow(searchParams, now));
	addSharedFilters(searchParams, query);
	copyParameter(searchParams, query, "category");
	query.set("interval", interval);
	return query;
}

// A filter change closes the open detail, since the list it sits in is read afresh. The
// spending card's grouping does not change the list, so a group change keeps the detail open.
// A new period or bucket size makes a selected bucket stale, so it goes too.
export function buildFilterHref(
	searchParams: URLSearchParams,
	name: string,
	value: string
) {
	const next = new URLSearchParams(searchParams);
	if (name !== "group") next.delete("open");
	if (name === "months") {
		next.delete("bucket");
		next.delete("interval");
	}
	if (name === "interval") next.delete("bucket");
	if (value === "") next.delete(name);
	else next.set(name, value);
	return `/overview?${next}`;
}

// Whether the spending card groups its rows by transaction type rather than by category
export function isGroupedByType(searchParams: URLSearchParams) {
	return searchParams.get("group") === "type";
}

// The category rows compare each category with its usual month, and so the usual query is
// read, only on the Category tab over a period shorter than 12 months with no bucket picked
export function isUsualRead(
	searchParams: URLSearchParams,
	months: number,
	selectedBucket: string | undefined
) {
	if (isGroupedByType(searchParams)) return false;
	return isUsualShown(months, selectedBucket);
}

export function hasFilters(searchParams: URLSearchParams) {
	for (const name of FILTER_NAMES) {
		const value = searchParams.get(name);
		if (value !== null && value !== "") return true;
	}
	return false;
}

// Whether anything but a selected bucket narrows the list
export function hasFiltersBesideBucket(searchParams: URLSearchParams) {
	const withoutBucket = new URLSearchParams(searchParams);
	withoutBucket.delete("bucket");
	return hasFilters(withoutBucket);
}

// Picking what is already picked deselects it
export function buildToggleHref(
	searchParams: URLSearchParams,
	name: "bucket" | "category" | "transactionType",
	value: string
) {
	const next = new URLSearchParams(searchParams);
	next.delete("open");
	if (next.get(name) === value) next.delete(name);
	else next.set(name, value);
	return `/overview?${next}`;
}

// Clears the filters and selections; the period, bucket size and list settings stay
export function buildClearAllHref(searchParams: URLSearchParams) {
	const next = new URLSearchParams(searchParams);
	for (const name of FILTER_NAMES) {
		next.delete(name);
	}
	next.delete("open");
	return `/overview?${next}`;
}

// The amount range is a filter: each bound is set when given and removed when empty
export function buildAmountRangeHref(
	searchParams: URLSearchParams,
	amountMin: string,
	amountMax: string
) {
	const next = new URLSearchParams(searchParams);
	next.delete("open");
	if (amountMin === "") next.delete("amountMin");
	else next.set("amountMin", amountMin);
	if (amountMax === "") next.delete("amountMax");
	else next.set("amountMax", amountMax);
	return `/overview?${next}`;
}

// Opening or closing a detail keeps the rest of the URL
export function buildOpenHref(
	searchParams: URLSearchParams,
	transactionId: string | undefined
) {
	const next = new URLSearchParams(searchParams);
	if (transactionId === undefined) next.delete("open");
	else next.set("open", transactionId);
	return `/overview?${next}`;
}

export function readOpenTransactionId(searchParams: URLSearchParams) {
	const transactionId = searchParams.get("open");
	if (transactionId === null || transactionId === "") return undefined;
	return transactionId;
}
