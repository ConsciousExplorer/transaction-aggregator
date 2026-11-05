import assert from "node:assert/strict";
import { test } from "node:test";
import { filterCategories } from "./category-search.ts";
import type { Category } from "./types.ts";

function buildCategory(categoryId: number, slug: string, label: string) {
	const category: Category = { categoryId, category: slug, label };
	return category;
}

const CATEGORIES = [
	buildCategory(1, "dining", "Dining"),
	buildCategory(2, "groceries", "Groceries"),
	buildCategory(3, "loan_repayment", "Loan repayment"),
	buildCategory(4, "recurring_payments", "Recurring payments"),
	buildCategory(5, "retail", "Retail"),
	buildCategory(6, "transfers", "Transfers")
];

const ALL_LABELS = [
	"Dining",
	"Groceries",
	"Loan repayment",
	"Recurring payments",
	"Retail",
	"Transfers"
];

function listLabels(categories: Category[]) {
	const labels: string[] = [];
	for (const category of categories) {
		labels.push(category.label);
	}
	return labels;
}

test("an empty or blank search returns every category in order", () => {
	for (const search of ["", "   "]) {
		assert.deepEqual(
			listLabels(filterCategories(CATEGORIES, search, undefined)),
			ALL_LABELS
		);
	}
});

test("the search matches labels as a trimmed, case-insensitive substring", () => {
	const cases = [
		{ search: "DIN", labels: ["Dining"] },
		{ search: "pay", labels: ["Loan repayment", "Recurring payments"] },
		{ search: " retail ", labels: ["Retail"] },
		{ search: "fuel", labels: [] }
	];
	for (const searchCase of cases) {
		assert.deepEqual(
			listLabels(filterCategories(CATEGORIES, searchCase.search, undefined)),
			searchCase.labels,
			`search "${searchCase.search}"`
		);
	}
});

test("the excluded category is left out whether the search matches it or is empty", () => {
	assert.deepEqual(listLabels(filterCategories(CATEGORIES, "din", 1)), []);
	assert.deepEqual(listLabels(filterCategories(CATEGORIES, "", 1)), [
		"Groceries",
		"Loan repayment",
		"Recurring payments",
		"Retail",
		"Transfers"
	]);
});

test("without an exclusion nothing is removed", () => {
	assert.equal(
		filterCategories(CATEGORIES, "", undefined).length,
		CATEGORIES.length
	);
});
