import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildHueClassName,
	readCategoryHue,
	readCategoryIconName,
	readTypeIconName
} from "./category-style.ts";
import type { TransactionType } from "./types.ts";

// Every entry of the style maps, written out, so an edit to any one of them fails its own test

const CATEGORY_HUE_TABLE = [
	{ slug: "transfers", hue: "blue" },
	{ slug: "transport", hue: "orange" },
	{ slug: "groceries", hue: "aqua" },
	{ slug: "loan_repayment", hue: "yellow" },
	{ slug: "retail", hue: "magenta" },
	{ slug: "healthcare", hue: "green" },
	{ slug: "insurance", hue: "red" },
	{ slug: "uncategorised", hue: "unknown" }
];

const CATEGORY_ICON_TABLE = [
	{ slug: "transfers", iconName: "transfers" },
	{ slug: "transport", iconName: "car" },
	{ slug: "groceries", iconName: "cart" },
	{ slug: "loan_repayment", iconName: "bank" },
	{ slug: "retail", iconName: "bag" },
	{ slug: "healthcare", iconName: "health" },
	{ slug: "insurance", iconName: "shield" },
	{ slug: "entertainment", iconName: "ticket" },
	{ slug: "subscriptions", iconName: "repeat" },
	{ slug: "dining", iconName: "dining" },
	{ slug: "income", iconName: "income" },
	{ slug: "education", iconName: "book" },
	{ slug: "fitness", iconName: "fitness" },
	{ slug: "recurring_payments", iconName: "calendar" },
	{ slug: "utilities", iconName: "bolt" }
];

const TYPE_ICON_TABLE: {
	transactionType: TransactionType;
	iconName: string;
}[] = [
	{ transactionType: "card", iconName: "card" },
	{ transactionType: "eft", iconName: "bank" },
	{ transactionType: "debit_order", iconName: "calendar" },
	{ transactionType: "internal_transfer", iconName: "transfers" }
];

for (const entry of CATEGORY_HUE_TABLE) {
	test(`${entry.slug} reads the ${entry.hue} hue`, () => {
		assert.equal(readCategoryHue(entry.slug), entry.hue);
	});
}

for (const entry of CATEGORY_ICON_TABLE) {
	test(`${entry.slug} draws the ${entry.iconName} icon`, () => {
		assert.equal(readCategoryIconName(entry.slug), entry.iconName);
	});
}

for (const entry of TYPE_ICON_TABLE) {
	test(`the ${entry.transactionType} type draws the ${entry.iconName} icon`, () => {
		assert.equal(readTypeIconName(entry.transactionType), entry.iconName);
	});
}

test("a seeded category without a hue of its own reads neutral", () => {
	assert.equal(readCategoryHue("fitness"), "neutral");
});

test("a slug the map does not know reads neutral instead of failing", () => {
	assert.equal(readCategoryHue("made_up"), "neutral");
});

test("a slug the map does not know draws the unknown icon instead of failing", () => {
	assert.equal(readCategoryIconName("made_up"), "unknown");
});

test("a slug named after a built-in object key falls back like any unknown slug", () => {
	assert.equal(readCategoryHue("constructor"), "neutral");
	assert.equal(readCategoryIconName("constructor"), "unknown");
});

test("a hue's class name is the hue after the hue- prefix", () => {
	assert.equal(buildHueClassName("red"), "hue-red");
});
