import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildCategoryFigures,
	listShownCategories,
	orderCategories,
	readCategoryFigures
} from "./categories.ts";
import type { Category, SummaryRow } from "./types.ts";

// A category's summary row: what went out and how many times, and what came in and how many
// times. Its count is both sides together.
function buildSummaryRow(
	category: string,
	debitMinor: number,
	debitCount: number,
	creditMinor: number,
	creditCount: number
): SummaryRow {
	return {
		group: { category },
		count: debitCount + creditCount,
		debit: {
			count: debitCount,
			total: { amountMinor: debitMinor, currency: "ZAR" }
		},
		credit: {
			count: creditCount,
			total: { amountMinor: creditMinor, currency: "ZAR" }
		},
		netAmount: { amountMinor: creditMinor - debitMinor, currency: "ZAR" }
	};
}

function buildCategory(category: string, label: string, categoryId: number) {
	return { categoryId, category, label };
}

function listSlugs(categories: Category[]) {
	const slugs = [];
	for (const category of categories) {
		slugs.push(category.category);
	}
	return slugs;
}

const dining = buildCategory("dining", "Dining out", 1);
const salary = buildCategory("salary", "Salary", 2);
const groceries = buildCategory("groceries", "Groceries", 3);
const education = buildCategory("education", "Education", 4);

test("orders categories by activity in the period, then by name", () => {
	const figures = {
		groceries: {
			moneyInMinor: 0,
			moneyOutMinor: 500,
			count: 3,
			moneyOutCount: 3
		},
		salary: { moneyInMinor: 9000, moneyOutMinor: 0, count: 1, moneyOutCount: 0 }
	};
	const input = [dining, salary, groceries, education];
	const ordered = orderCategories(input, figures);
	assert.deepEqual(listSlugs(ordered), [
		"groceries",
		"salary",
		"dining",
		"education"
	]);
	assert.deepEqual(listSlugs(input), [
		"dining",
		"salary",
		"groceries",
		"education"
	]);
});

test("a category the summary has no row for has zero figures", () => {
	assert.deepEqual(readCategoryFigures({}, "dining"), {
		moneyInMinor: 0,
		moneyOutMinor: 0,
		count: 0,
		moneyOutCount: 0
	});
});

test("the list shows only the categories with transactions, in their ranked order", () => {
	const figures = {
		transfers: {
			moneyInMinor: 0,
			moneyOutMinor: 900,
			count: 2,
			moneyOutCount: 2
		},
		groceries: {
			moneyInMinor: 0,
			moneyOutMinor: 500,
			count: 3,
			moneyOutCount: 3
		}
	};
	const transfers = buildCategory("transfers", "Transfers", 5);
	const shown = listShownCategories(
		[transfers, dining, groceries, education],
		figures,
		undefined
	);
	assert.deepEqual(listSlugs(shown), ["transfers", "groceries"]);
});

test("a category with money in and none out has transactions, so it shows", () => {
	const figures = {
		salary: { moneyInMinor: 9000, moneyOutMinor: 0, count: 1, moneyOutCount: 0 }
	};
	const shown = listShownCategories([salary, education], figures, undefined);
	assert.deepEqual(listSlugs(shown), ["salary"]);
});

test("a remapped category shows with no transactions, since only its row can remove the remap", () => {
	const remapped: Category = {
		...education,
		mappedTo: {
			categoryId: dining.categoryId,
			category: dining.category,
			label: dining.label,
			updatedAt: "2026-11-05T10:00:00.000Z"
		}
	};
	const shown = listShownCategories([remapped, groceries], {}, undefined);
	assert.deepEqual(listSlugs(shown), ["education"]);
});

test("the selected category shows with no transactions, so the selection stays in view", () => {
	const shown = listShownCategories([groceries, education], {}, "education");
	assert.deepEqual(listSlugs(shown), ["education"]);
});

test("the list is empty when no category has transactions", () => {
	assert.deepEqual(listShownCategories([dining, groceries], {}, undefined), []);
});

test("keys the summary's rows by category, counting money out apart from every transaction", () => {
	const figures = buildCategoryFigures([
		buildSummaryRow("groceries", 300, 3, 0, 0),
		buildSummaryRow("salary", 0, 0, 1000, 1),
		buildSummaryRow("transfers", 900, 2, 400, 3)
	]);
	assert.deepEqual(figures, {
		groceries: {
			moneyInMinor: 0,
			moneyOutMinor: 300,
			count: 3,
			moneyOutCount: 3
		},
		salary: {
			moneyInMinor: 1000,
			moneyOutMinor: 0,
			count: 1,
			moneyOutCount: 0
		},
		transfers: {
			moneyInMinor: 400,
			moneyOutMinor: 900,
			count: 5,
			moneyOutCount: 2
		}
	});
});
