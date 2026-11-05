import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BucketTotal,
	buildBucketKey,
	buildBucketTotals,
	buildBucketWindow,
	chooseBucketLabelRank,
	fillMissingBuckets,
	formatBucket,
	readBucket,
	readBucketInterval
} from "./buckets.ts";
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

function listBuckets(totals: BucketTotal[]) {
	const buckets: string[] = [];
	for (const total of totals) {
		buckets.push(total.bucket);
	}
	return buckets;
}

test("reads only the API's three bucket shapes", () => {
	assert.equal(readBucket("2026-08"), "2026-08");
	assert.equal(readBucket("2026-W33"), "2026-W33");
	assert.equal(readBucket("2026-08-15"), "2026-08-15");
	assert.equal(readBucket("2026-13"), undefined);
	assert.equal(readBucket("2026-W54"), undefined);
	assert.equal(readBucket("2026-W00"), undefined);
	assert.equal(readBucket("garbage"), undefined);
	assert.equal(readBucket(null), undefined);
});

test("tells a bucket's interval from its shape", () => {
	assert.equal(readBucketInterval("2026-08"), "month");
	assert.equal(readBucketInterval("2026-W33"), "week");
	assert.equal(readBucketInterval("2026-08-15"), "day");
});

test("keys a date the way the API labels buckets, in UTC and ISO weeks", () => {
	assert.equal(
		buildBucketKey(new Date("2026-08-15T23:30:00Z"), "day"),
		"2026-08-15"
	);
	assert.equal(
		buildBucketKey(new Date("2026-08-15T23:30:00Z"), "month"),
		"2026-08"
	);
	assert.equal(
		buildBucketKey(new Date("2026-08-15T00:00:00Z"), "week"),
		"2026-W33"
	);
	assert.equal(
		buildBucketKey(new Date("2026-01-01T00:00:00Z"), "week"),
		"2026-W01"
	);
	assert.equal(
		buildBucketKey(new Date("2024-12-30T00:00:00Z"), "week"),
		"2025-W01"
	);
});

test("a bucket's window is the API's, in UTC, end exclusive", () => {
	assert.deepEqual(buildBucketWindow("2026-08"), {
		fromDateTime: "2026-08-01T00:00:00.000Z",
		toDateTime: "2026-09-01T00:00:00.000Z"
	});
	assert.deepEqual(buildBucketWindow("2025-12"), {
		fromDateTime: "2025-12-01T00:00:00.000Z",
		toDateTime: "2026-01-01T00:00:00.000Z"
	});
	assert.deepEqual(buildBucketWindow("2026-W33"), {
		fromDateTime: "2026-08-10T00:00:00.000Z",
		toDateTime: "2026-08-17T00:00:00.000Z"
	});
	assert.deepEqual(buildBucketWindow("2025-W01"), {
		fromDateTime: "2024-12-30T00:00:00.000Z",
		toDateTime: "2025-01-06T00:00:00.000Z"
	});
	// a 53-week year: its last week runs into the next calendar year
	assert.deepEqual(buildBucketWindow("2020-W53"), {
		fromDateTime: "2020-12-28T00:00:00.000Z",
		toDateTime: "2021-01-04T00:00:00.000Z"
	});
	assert.deepEqual(buildBucketWindow("2026-08-15"), {
		fromDateTime: "2026-08-15T00:00:00.000Z",
		toDateTime: "2026-08-16T00:00:00.000Z"
	});
});

test("names a bucket for a person, short for an axis and long for a filter", () => {
	assert.equal(formatBucket("2026-08", "short"), "Aug");
	assert.equal(formatBucket("2026-08", "long"), "August 2026");
	assert.equal(formatBucket("2026-08-15", "short"), "15");
	assert.equal(formatBucket("2026-08-05", "short"), "5");
	assert.equal(formatBucket("2026-08-15", "long"), "15 Aug 2026");
	assert.equal(formatBucket("2026-W33", "short"), "10 Aug");
	assert.equal(formatBucket("2026-W33", "long"), "Week 33, 10–16 Aug 2026");
	assert.equal(
		formatBucket("2026-W05", "long"),
		"Week 5, 26 Jan – 01 Feb 2026"
	);
	assert.equal(
		formatBucket("2026-W01", "long"),
		"Week 1, 29 Dec 2025 – 04 Jan 2026"
	);
});

test("adds every category's money in and out per bucket, oldest first", () => {
	const rows = [
		buildSummaryRow({ category: "groceries", week: "2026-W33" }, 100, 0),
		buildSummaryRow({ category: "salary", week: "2026-W32" }, 0, 500),
		buildSummaryRow({ category: "dining", week: "2026-W33" }, 50, 0)
	];
	assert.deepEqual(buildBucketTotals(rows, "week"), [
		{ bucket: "2026-W32", moneyInMinor: 500, moneyOutMinor: 0 },
		{ bucket: "2026-W33", moneyInMinor: 0, moneyOutMinor: 150 }
	]);
});

test("fills the buckets the API had no row for, up to the window's end", () => {
	assert.deepEqual(
		fillMissingBuckets(
			[{ bucket: "2026-08-15", moneyInMinor: 0, moneyOutMinor: 100 }],
			"day",
			"2026-08-14T10:00:00.000Z",
			"2026-08-16T10:00:00.000Z"
		),
		[
			{ bucket: "2026-08-14", moneyInMinor: 0, moneyOutMinor: 0 },
			{ bucket: "2026-08-15", moneyInMinor: 0, moneyOutMinor: 100 },
			{ bucket: "2026-08-16", moneyInMinor: 0, moneyOutMinor: 0 }
		]
	);
	// a window ending exactly on a boundary does not add the bucket that starts there
	assert.deepEqual(
		listBuckets(
			fillMissingBuckets(
				[],
				"month",
				"2026-07-01T00:00:00.000Z",
				"2026-09-01T00:00:00.000Z"
			)
		),
		["2026-07", "2026-08"]
	);
	// 29 Dec 2025 is the Monday of 2026-W01; 13 Jan 2026 is the Tuesday of W03, so W03 is in
	assert.deepEqual(
		listBuckets(
			fillMissingBuckets(
				[],
				"week",
				"2025-12-29T00:00:00.000Z",
				"2026-01-13T00:00:00.000Z"
			)
		),
		["2026-W01", "2026-W02", "2026-W03"]
	);
});

test("thins the axis labels so they never overlap", () => {
	assert.equal(chooseBucketLabelRank("2026-08", "month", 0), "major");
	assert.equal(chooseBucketLabelRank("2026-09", "month", 1), "minor");
	assert.equal(chooseBucketLabelRank("2026-W33", "week", 4), "minor");
	assert.equal(chooseBucketLabelRank("2026-W33", "week", 8), "major");
	assert.equal(chooseBucketLabelRank("2026-W33", "week", 3), undefined);
	assert.equal(chooseBucketLabelRank("2026-08-01", "day", 7), "major");
	assert.equal(chooseBucketLabelRank("2026-08-15", "day", 7), "minor");
	assert.equal(chooseBucketLabelRank("2026-08-16", "day", 7), undefined);
});
