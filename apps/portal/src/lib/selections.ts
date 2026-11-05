import { fillMissingBuckets, formatBucket, readBucket } from "./buckets.ts";
import { describeLastPeriod, type Interval } from "./periods.ts";
import { buildToggleHref } from "./transaction-query.ts";
import type { Category } from "./types.ts";

export type SelectionChip = {
	name: "bucket" | "category";
	label: string;
	href: string;
};

// The keys of every bucket the chart shows for a period, empty ones included
export function listBucketKeys(
	interval: Interval,
	period: { fromDateTime: string; toDateTime: string }
) {
	const buckets = fillMissingBuckets(
		[],
		interval,
		period.fromDateTime,
		period.toDateTime
	);
	const bucketKeys: string[] = [];
	for (const bucket of buckets) {
		bucketKeys.push(bucket.bucket);
	}
	return bucketKeys;
}

// A bucket left in the URL from another period or bucket size is not on the chart, so it is
// ignored everywhere
export function readSelectedBucket(
	searchParams: URLSearchParams,
	bucketKeys: string[]
) {
	const bucket = readBucket(searchParams.get("bucket"));
	if (bucket === undefined) return undefined;
	if (!bucketKeys.includes(bucket)) return undefined;
	return bucket;
}

export function readSelectedCategory(
	searchParams: URLSearchParams,
	categories: Category[]
) {
	const slug = searchParams.get("category");
	for (const category of categories) {
		if (category.category === slug) return category.category;
	}
	return undefined;
}

// A chip names a selection, and its link removes it
export function describeChips(
	searchParams: URLSearchParams,
	selectedBucket: string | undefined,
	selectedCategory: string | undefined,
	categories: Category[]
) {
	const chips: SelectionChip[] = [];
	if (selectedBucket !== undefined) {
		chips.push({
			name: "bucket",
			label: formatBucket(selectedBucket, "long"),
			href: buildToggleHref(searchParams, "bucket", selectedBucket)
		});
	}
	if (selectedCategory !== undefined) {
		let label = selectedCategory;
		for (const category of categories) {
			if (category.category === selectedCategory) label = category.label;
		}
		chips.push({
			name: "category",
			label,
			href: buildToggleHref(searchParams, "category", selectedCategory)
		});
	}
	return chips;
}

export function findChipLabel(
	chips: SelectionChip[],
	name: SelectionChip["name"]
) {
	for (const chip of chips) {
		if (chip.name === name) return chip.label;
	}
	return undefined;
}

// The ring's caption names the window its money out covers: the selected bucket in its chip's
// words, else the period. A selected category does not narrow the ring, so it is not named. A
// week's chip starts with "Week"; after "money out ·" it is "week", joined to its number by a
// no-break space so a narrow ring never wraps between the two.
export function describeRingCaption(chips: SelectionChip[], months: number) {
	const bucketLabel = findChipLabel(chips, "bucket");
	if (bucketLabel !== undefined)
		return bucketLabel.replace(/^Week /, `week\u00a0`);
	return describeLastPeriod(months);
}
