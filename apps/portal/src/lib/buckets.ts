import type { Interval } from "./periods.ts";
import type { SummaryRow } from "./types.ts";

export interface BucketTotal {
	bucket: string;
	moneyInMinor: number;
	moneyOutMinor: number;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Buckets are UTC, so every label is formatted in UTC too
const shortMonthFormatter = new Intl.DateTimeFormat("en-ZA", {
	month: "short",
	timeZone: "UTC"
});
const longMonthFormatter = new Intl.DateTimeFormat("en-ZA", {
	month: "long",
	year: "numeric",
	timeZone: "UTC"
});
const dayFormatter = new Intl.DateTimeFormat("en-ZA", {
	day: "2-digit",
	timeZone: "UTC"
});
const dayMonthFormatter = new Intl.DateTimeFormat("en-ZA", {
	day: "2-digit",
	month: "short",
	timeZone: "UTC"
});
const dayMonthYearFormatter = new Intl.DateTimeFormat("en-ZA", {
	day: "2-digit",
	month: "short",
	year: "numeric",
	timeZone: "UTC"
});

// Anything but the API's three bucket shapes is not a bucket
export function readBucket(value: string | null) {
	if (value === null) return undefined;
	if (MONTH_PATTERN.test(value)) return value;
	if (WEEK_PATTERN.test(value)) return value;
	if (DAY_PATTERN.test(value)) return value;
	return undefined;
}

export function readBucketInterval(bucket: string): Interval {
	if (bucket.includes("W")) return "week";
	if (bucket.length === 7) return "month";
	return "day";
}

function padNumber(value: number, width: number) {
	return String(value).padStart(width, "0");
}

function addDays(date: Date, days: number) {
	return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

// The ISO week-year and number come from the Thursday of the date's week
function buildWeekKey(date: Date) {
	const day = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
	const isoWeekday = (day.getUTCDay() + 6) % 7;
	const thursday = addDays(day, 3 - isoWeekday);
	const year = thursday.getUTCFullYear();
	const startOfYear = Date.UTC(year, 0, 1);
	const dayOfYear =
		(thursday.getTime() - startOfYear) / MILLISECONDS_PER_DAY + 1;
	const week = 1 + Math.floor((dayOfYear - 1) / 7);
	return `${year}-W${padNumber(week, 2)}`;
}

export function buildBucketKey(date: Date, interval: Interval) {
	if (interval === "week") return buildWeekKey(date);
	const month = padNumber(date.getUTCMonth() + 1, 2);
	const key = `${date.getUTCFullYear()}-${month}`;
	if (interval === "month") return key;
	return `${key}-${padNumber(date.getUTCDate(), 2)}`;
}

// Monday of ISO week 1 is the Monday on or before 4 January
function buildWeekStart(bucket: string) {
	const year = Number(bucket.slice(0, 4));
	const week = Number(bucket.slice(6));
	const fourthOfJanuary = new Date(Date.UTC(year, 0, 4));
	const isoWeekday = (fourthOfJanuary.getUTCDay() + 6) % 7;
	const firstMonday = addDays(fourthOfJanuary, -isoWeekday);
	return addDays(firstMonday, (week - 1) * 7);
}

// The window a bucket covers. The API buckets in UTC and its toDateTime is exclusive, so a
// bucket runs from its first instant up to the next bucket's.
export function buildBucketWindow(bucket: string) {
	const interval = readBucketInterval(bucket);
	if (interval === "month") {
		const from = new Date(`${bucket}-01T00:00:00.000Z`);
		const to = new Date(from);
		to.setUTCMonth(to.getUTCMonth() + 1);
		return { fromDateTime: from.toISOString(), toDateTime: to.toISOString() };
	}
	if (interval === "week") {
		const from = buildWeekStart(bucket);
		const to = addDays(from, 7);
		return { fromDateTime: from.toISOString(), toDateTime: to.toISOString() };
	}
	const from = new Date(`${bucket}T00:00:00.000Z`);
	const to = addDays(from, 1);
	return { fromDateTime: from.toISOString(), toDateTime: to.toISOString() };
}

function formatWeek(bucket: string, style: "short" | "long") {
	const window = buildBucketWindow(bucket);
	const first = new Date(window.fromDateTime);
	if (style === "short") {
		const month = shortMonthFormatter.format(first);
		return `${first.getUTCDate()} ${month}`;
	}
	const last = addDays(new Date(window.toDateTime), -1);
	const week = Number(bucket.slice(6));
	const isSameYear = first.getUTCFullYear() === last.getUTCFullYear();
	const isSameMonth = isSameYear && first.getUTCMonth() === last.getUTCMonth();
	if (isSameMonth) {
		const firstDay = dayFormatter.format(first);
		return `Week ${week}, ${firstDay}–${dayMonthYearFormatter.format(last)}`;
	}
	if (isSameYear) {
		const firstDayMonth = dayMonthFormatter.format(first);
		return `Week ${week}, ${firstDayMonth} – ${dayMonthYearFormatter.format(last)}`;
	}
	const firstFull = dayMonthYearFormatter.format(first);
	return `Week ${week}, ${firstFull} – ${dayMonthYearFormatter.format(last)}`;
}

// Short names fit an axis, long ones say which bucket a filter is on
export function formatBucket(bucket: string, style: "short" | "long") {
	const interval = readBucketInterval(bucket);
	if (interval === "week") return formatWeek(bucket, style);
	if (interval === "month") {
		const date = new Date(`${bucket}-01T00:00:00Z`);
		if (style === "short") return shortMonthFormatter.format(date);
		return longMonthFormatter.format(date);
	}
	if (style === "short") return String(Number(bucket.slice(8)));
	return dayMonthYearFormatter.format(new Date(`${bucket}T00:00:00Z`));
}

// The summary has a row per bucket and category; the chart wants one per bucket. Sorted
// first, so each bucket's rows are adjacent and add onto the last entry.
export function buildBucketTotals(rows: SummaryRow[], interval: Interval) {
	const sorted = [...rows].sort((first, second) =>
		(first.group[interval] ?? "").localeCompare(second.group[interval] ?? "")
	);
	const totals: BucketTotal[] = [];
	for (const row of sorted) {
		const bucket = row.group[interval] ?? "";
		const last = totals[totals.length - 1];
		if (last !== undefined && last.bucket === bucket) {
			last.moneyInMinor += row.credit.total.amountMinor;
			last.moneyOutMinor += row.debit.total.amountMinor;
		} else {
			totals.push({
				bucket,
				moneyInMinor: row.credit.total.amountMinor,
				moneyOutMinor: row.debit.total.amountMinor
			});
		}
	}
	return totals;
}

function findBucketTotal(totals: BucketTotal[], bucket: string) {
	for (const total of totals) {
		if (total.bucket === bucket) return total;
	}
	return undefined;
}

// The API has no row for a bucket without transactions, and an axis that skips buckets reads
// as if none were missing. Walk from the bucket holding the start to the last one that
// begins before the end.
export function fillMissingBuckets(
	totals: BucketTotal[],
	interval: Interval,
	fromDateTime: string,
	toDateTime: string
) {
	const end = new Date(toDateTime).getTime();
	const filled: BucketTotal[] = [];
	let bucket = buildBucketKey(new Date(fromDateTime), interval);
	let window = buildBucketWindow(bucket);
	while (new Date(window.fromDateTime).getTime() < end) {
		filled.push(
			findBucketTotal(totals, bucket) ?? {
				bucket,
				moneyInMinor: 0,
				moneyOutMinor: 0
			}
		);
		bucket = buildBucketKey(new Date(window.toDateTime), interval);
		window = buildBucketWindow(bucket);
	}
	return filled;
}

const DAY_LABEL_DAYS = [1, 5, 10, 15, 20, 25, 30];
const MAJOR_DAY_LABEL_DAYS = [1, 10, 20, 30];

// Which bars get an axis label, so the labels never overlap: every month, every 4th week and
// the 1st, 5th, 10th... of the month for days. Major ones are drawn stronger.
export function chooseBucketLabelRank(
	bucket: string,
	interval: Interval,
	index: number
) {
	if (interval === "month") return index % 2 === 0 ? "major" : "minor";
	if (interval === "week") {
		if (index % 8 === 0) return "major";
		if (index % 4 === 0) return "minor";
		return undefined;
	}
	const dayOfMonth = Number(bucket.slice(8));
	if (MAJOR_DAY_LABEL_DAYS.includes(dayOfMonth)) return "major";
	if (DAY_LABEL_DAYS.includes(dayOfMonth)) return "minor";
	return undefined;
}
