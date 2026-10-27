import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildFilterHref,
	buildListQuery,
	buildMonthHref,
	buildSpendingHref,
	readPeriodValue
} from "./transaction-query.ts";

const NOW = new Date("2026-10-19T10:00:00.000Z");

test("a chosen month reads exactly that month", () => {
	const query = buildListQuery(
		new URLSearchParams("month=2026-08&limit=25"),
		NOW
	);
	assert.equal(query.get("fromDateTime"), "2026-08-01T00:00:00.000Z");
	assert.equal(query.get("toDateTime"), "2026-09-01T00:00:00.000Z");
	assert.equal(query.get("limit"), "25");
});

test("a walk keeps its own window, even with a month chosen", () => {
	const query = buildListQuery(
		new URLSearchParams(
			"month=2026-08&cursor=abc&from=2026-08-01T00:00:00.000Z&to=2026-08-15T00:00:00.000Z"
		),
		NOW
	);
	assert.equal(query.get("toDateTime"), "2026-08-15T00:00:00.000Z");
	assert.equal(query.get("cursor"), "abc");
});

test("without a month or a walk, reads the period up to now", () => {
	const query = buildListQuery(new URLSearchParams("months=3"), NOW);
	assert.equal(query.get("fromDateTime"), "2026-07-19T10:00:00.000Z");
	assert.equal(query.get("toDateTime"), "2026-10-19T10:00:00.000Z");
});

test("ignores a malformed month and reads the period", () => {
	const query = buildListQuery(new URLSearchParams("month=2026-13"), NOW);
	assert.equal(query.get("fromDateTime"), "2025-10-19T10:00:00.000Z");
});

test("changing another filter keeps the month and starts a new walk", () => {
	const searchParams = new URLSearchParams(
		"month=2026-08&cursor=abc&page=2&from=x&to=y"
	);
	assert.equal(
		buildFilterHref(searchParams, "category", "groceries"),
		"/transactions?month=2026-08&category=groceries"
	);
});

test("choosing a period replaces the month", () => {
	const searchParams = new URLSearchParams("month=2026-08&category=groceries");
	assert.equal(
		buildFilterHref(searchParams, "months", "3"),
		"/transactions?category=groceries&months=3"
	);
});

test("the period filter shows the chosen month, else the months", () => {
	assert.equal(
		readPeriodValue(new URLSearchParams("month=2026-08&months=3")),
		"2026-08"
	);
	assert.equal(readPeriodValue(new URLSearchParams("months=3")), "3");
	assert.equal(readPeriodValue(new URLSearchParams("")), "12");
});

test("a category's spending opens its money out only", () => {
	assert.equal(
		buildSpendingHref("groceries", 12),
		"/transactions?category=groceries&months=12&creditDebitIndicator=debit"
	);
});

test("a month column opens that month", () => {
	assert.equal(buildMonthHref("2026-08"), "/transactions?month=2026-08");
});
