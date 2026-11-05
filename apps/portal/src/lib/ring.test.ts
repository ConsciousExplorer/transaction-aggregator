import assert from "node:assert/strict";
import { test } from "node:test";
import type { CategoryFigures } from "./categories.ts";
import {
	buildRingArcs,
	buildRingSegments,
	calculateAverageMinor,
	calculateMonthlyAverage,
	calculateShare
} from "./ring.ts";
import type { Category } from "./types.ts";

function buildCategory(category: string, label: string) {
	return { categoryId: 1, category, label };
}

function buildFigures(moneyOutMinor: number) {
	const count = moneyOutMinor > 0 ? 1 : 0;
	return { moneyInMinor: 0, moneyOutMinor, count, moneyOutCount: count };
}

// Categories named a, b, c… with the money out given, in that order
function buildSpending(amounts: number[]) {
	const ranked: Category[] = [];
	const figures: Record<string, CategoryFigures> = {};
	for (const [index, amount] of amounts.entries()) {
		const slug = String.fromCharCode(97 + index);
		ranked.push(buildCategory(slug, slug.toUpperCase()));
		figures[slug] = buildFigures(amount);
	}
	return { ranked, figures };
}

function listShares(segments: { share: number }[]) {
	const shares = [];
	for (const segment of segments) {
		shares.push(segment.share);
	}
	return shares;
}

test("each category with money out is a segment with its share of the total", () => {
	const ranked = [
		buildCategory("transfers", "Transfers"),
		buildCategory("transport", "Transport"),
		buildCategory("groceries", "Groceries")
	];
	const figures = {
		transfers: buildFigures(6000),
		transport: buildFigures(3000),
		groceries: buildFigures(1000)
	};
	const segments = buildRingSegments(ranked, figures);
	assert.deepEqual(listShares(segments), [60, 30, 10]);
	assert.deepEqual(segments[0], {
		label: "Transfers",
		slug: "transfers",
		amountMinor: 6000,
		share: 60,
		hue: "blue"
	});
	for (const segment of segments) {
		assert.notEqual(segment.label, "Other");
	}
});

test("past the seventh category the rest are summed into a neutral Other", () => {
	const { ranked, figures } = buildSpending([
		900, 800, 700, 600, 500, 400, 300, 200, 100
	]);
	const segments = buildRingSegments(ranked, figures);
	assert.equal(segments.length, 8);
	assert.deepEqual(segments[7], {
		label: "Other",
		slug: undefined,
		amountMinor: 300,
		share: 7,
		hue: "neutral"
	});
});

test("a category with nothing out is left off the ring", () => {
	const { ranked, figures } = buildSpending([500, 0, 500]);
	const segments = buildRingSegments(ranked, figures);
	assert.equal(segments.length, 2);
});

test("a period with no money out has no segments", () => {
	const { ranked, figures } = buildSpending([0, 0]);
	assert.deepEqual(buildRingSegments(ranked, figures), []);
	assert.deepEqual(buildRingSegments([], {}), []);
});

test("one category holding all the money is a full circle drawn as two half arcs", () => {
	const { ranked, figures } = buildSpending([12345]);
	const segments = buildRingSegments(ranked, figures);
	const arcs = buildRingArcs(segments, 260, 20);
	assert.equal(arcs.length, 2);
	assert.equal(arcs[0]?.segment, segments[0]);
	assert.equal(arcs[1]?.segment, segments[0]);
	// Top to bottom down the right, then bottom to top up the left, with no seam
	assert.equal(arcs[0]?.d, "M130.00 10.00A120.00 120.00 0 0 1 130.00 250.00");
	assert.equal(arcs[1]?.d, "M130.00 250.00A120.00 120.00 0 0 1 130.00 10.00");
});

test("an arc starts half a seam past the top and runs clockwise", () => {
	// R 145 018,11 of R 236 065,56, about 61%: past the bottom, so a large arc, ending at
	// half a seam short of its share
	const { ranked, figures } = buildSpending([14501811, 9104745]);
	const arcs = buildRingArcs(buildRingSegments(ranked, figures), 260, 20);
	assert.equal(arcs.length, 2);
	assert.equal(arcs[0]?.d, "M131.50 10.01A120.00 120.00 0 1 1 52.17 221.34");
});

test("a sliver too thin for its seams keeps a hairline arc", () => {
	const { ranked, figures } = buildSpending([10000000, 1]);
	const arcs = buildRingArcs(buildRingSegments(ranked, figures), 260, 20);
	assert.equal(arcs.length, 2);
	// The large segment runs all the way round to half a seam short of the top
	assert.equal(arcs[0]?.d, "M131.50 10.01A120.00 120.00 0 1 1 128.50 10.01");
	// The sliver starts half a seam past the top and runs its 0.004 radian minimum
	assert.equal(arcs[1]?.d, "M131.50 10.01A120.00 120.00 0 0 1 131.98 10.02");
});

test("the average per transaction is whole minor units, and none without transactions", () => {
	assert.equal(calculateAverageMinor(100, 0), undefined);
	assert.equal(calculateAverageMinor(1000, 3), 333);
});

test("the monthly average divides the total by the period's months", () => {
	assert.equal(calculateMonthlyAverage(23606556, 12, undefined), 1967213);
	assert.equal(calculateMonthlyAverage(1000, 3, undefined), 333);
});

test("one month and a selected bucket have no monthly average", () => {
	assert.equal(calculateMonthlyAverage(3648988, 1, undefined), undefined);
	assert.equal(calculateMonthlyAverage(23606556, 12, "2026-08"), undefined);
	assert.equal(calculateMonthlyAverage(3648988, 3, "2026-W42"), undefined);
});

test("a share of nothing is zero", () => {
	assert.equal(calculateShare(500, 0), 0);
	assert.equal(calculateShare(1, 3), 33);
});
