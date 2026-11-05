import assert from "node:assert/strict";
import { test } from "node:test";
import {
	describeChips,
	describeRingCaption,
	findChipLabel,
	listBucketKeys,
	readSelectedBucket,
	readSelectedCategory
} from "./selections.ts";
import type { Category } from "./types.ts";

function buildCategory(category: string, label: string): Category {
	return { categoryId: 1, category, label };
}

const CATEGORIES = [
	buildCategory("dining", "Dining"),
	buildCategory("groceries", "Groceries")
];

test("lists the bucket keys a period covers, in order", () => {
	assert.deepEqual(
		listBucketKeys("month", {
			fromDateTime: "2026-07-19T10:00:00.000Z",
			toDateTime: "2026-10-19T10:00:00.000Z"
		}),
		["2026-07", "2026-08", "2026-09", "2026-10"]
	);
});

test("a selected bucket must be one of the period's buckets", () => {
	const bucketKeys = ["2026-08", "2026-09"];
	assert.equal(
		readSelectedBucket(new URLSearchParams("bucket=2026-09"), bucketKeys),
		"2026-09"
	);
	// A bucket left over from another period or interval is ignored
	assert.equal(
		readSelectedBucket(new URLSearchParams("bucket=2026-W33"), bucketKeys),
		undefined
	);
	assert.equal(
		readSelectedBucket(new URLSearchParams("bucket=2025-01"), bucketKeys),
		undefined
	);
	assert.equal(
		readSelectedBucket(new URLSearchParams("bucket=garbage"), bucketKeys),
		undefined
	);
	assert.equal(
		readSelectedBucket(new URLSearchParams(""), bucketKeys),
		undefined
	);
});

test("a selected category must be a known slug", () => {
	assert.equal(
		readSelectedCategory(new URLSearchParams("category=dining"), CATEGORIES),
		"dining"
	);
	assert.equal(
		readSelectedCategory(new URLSearchParams("category=unknown"), CATEGORIES),
		undefined
	);
	assert.equal(
		readSelectedCategory(new URLSearchParams(""), CATEGORIES),
		undefined
	);
});

test("one chip per active selection, bucket first, each linking to its removal", () => {
	const searchParams = new URLSearchParams(
		"months=3&bucket=2026-08&category=dining&open=tx-1"
	);
	assert.deepEqual(
		describeChips(searchParams, "2026-08", "dining", CATEGORIES),
		[
			{
				name: "bucket",
				label: "August 2026",
				href: "/overview?months=3&category=dining"
			},
			{
				name: "category",
				label: "Dining",
				href: "/overview?months=3&bucket=2026-08"
			}
		]
	);
});

test("no selections give no chips, and a stale selection gives none either", () => {
	const searchParams = new URLSearchParams("bucket=2025-01&category=unknown");
	assert.deepEqual(
		describeChips(searchParams, undefined, undefined, CATEGORIES),
		[]
	);
});

test("finds a chip's label by its name", () => {
	const chips = describeChips(
		new URLSearchParams("bucket=2026-08"),
		"2026-08",
		undefined,
		CATEGORIES
	);
	assert.equal(findChipLabel(chips, "bucket"), "August 2026");
	assert.equal(findChipLabel(chips, "category"), undefined);
});

test("the ring's caption names the period, or the selected bucket, never the category", () => {
	const searchParams = new URLSearchParams("bucket=2026-08&category=dining");
	const noSelection = describeChips(
		searchParams,
		undefined,
		undefined,
		CATEGORIES
	);
	assert.equal(describeRingCaption(noSelection, 12), "last 12 months");
	assert.equal(describeRingCaption(noSelection, 3), "last 3 months");
	assert.equal(describeRingCaption(noSelection, 1), "last month");
	assert.equal(
		describeRingCaption(
			describeChips(searchParams, "2026-08", undefined, CATEGORIES),
			3
		),
		"August 2026"
	);
	assert.equal(
		describeRingCaption(
			describeChips(searchParams, undefined, "dining", CATEGORIES),
			3
		),
		"last 3 months"
	);
	assert.equal(
		describeRingCaption(
			describeChips(searchParams, "2026-08", "dining", CATEGORIES),
			12
		),
		"August 2026"
	);
});

test("a selected week's caption is lower-case, its number held to it by a no-break space", () => {
	const chips = describeChips(
		new URLSearchParams("bucket=2026-W42"),
		"2026-W42",
		undefined,
		CATEGORIES
	);
	assert.equal(findChipLabel(chips, "bucket"), "Week 42, 12–18 Oct 2026");
	assert.equal(describeRingCaption(chips, 3), `week\u00a042, 12–18 Oct 2026`);
});
