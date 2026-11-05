import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildAmountRangeHref,
	buildByTypeQuery,
	buildChartQuery,
	buildClearAllHref,
	buildFiguresQuery,
	buildFilterHref,
	buildListQuery,
	buildOpenHref,
	buildSelectedWindow,
	buildToggleHref,
	buildUsualQuery,
	hasFilters,
	hasFiltersBesideBucket,
	isGroupedByType,
	isUsualRead,
	readOpenTransactionId,
	readPageSize
} from "./transaction-query.ts";

const NOW = new Date("2026-10-19T10:00:00.000Z");

function readHrefParams(href: string) {
	assert.ok(href.startsWith("/overview?"));
	return new URL(href, "http://x").searchParams;
}

test("a selected bucket sets the list and figures window, and the chart ignores it", () => {
	const searchParams = new URLSearchParams("months=3&bucket=2026-W33");
	const list = buildListQuery(searchParams, NOW, "2026-W33");
	assert.equal(list.get("fromDateTime"), "2026-08-10T00:00:00.000Z");
	assert.equal(list.get("toDateTime"), "2026-08-17T00:00:00.000Z");
	const figures = buildFiguresQuery(searchParams, NOW, "2026-W33");
	assert.equal(figures.get("fromDateTime"), "2026-08-10T00:00:00.000Z");
	assert.equal(figures.get("toDateTime"), "2026-08-17T00:00:00.000Z");
	const chart = buildChartQuery(searchParams, NOW, "week");
	assert.equal(chart.get("fromDateTime"), "2026-07-19T10:00:00.000Z");
	assert.equal(chart.get("toDateTime"), "2026-10-19T10:00:00.000Z");
});

test("without a selected bucket, the list and figures read the period up to now", () => {
	const searchParams = new URLSearchParams("months=3");
	for (const query of [
		buildListQuery(searchParams, NOW, undefined),
		buildFiguresQuery(searchParams, NOW, undefined)
	]) {
		assert.equal(query.get("fromDateTime"), "2026-07-19T10:00:00.000Z");
		assert.equal(query.get("toDateTime"), "2026-10-19T10:00:00.000Z");
	}
});

test("the chart query carries category and interval; the figures query never carries category", () => {
	const searchParams = new URLSearchParams(
		"category=dining&transactionType=card&creditDebitIndicator=debit&sort=occurredAt&limit=25"
	);
	const chart = buildChartQuery(searchParams, NOW, "month");
	assert.equal(chart.get("category"), "dining");
	assert.equal(chart.get("interval"), "month");
	assert.equal(chart.get("transactionType"), "card");
	assert.equal(chart.get("creditDebitIndicator"), "debit");
	assert.equal(chart.get("sort"), null);
	assert.equal(chart.get("limit"), null);
	const figures = buildFiguresQuery(searchParams, NOW, undefined);
	assert.equal(figures.get("category"), null);
	assert.equal(figures.get("interval"), null);
	assert.equal(figures.get("transactionType"), "card");
	assert.equal(figures.get("creditDebitIndicator"), "debit");
	assert.equal(figures.get("sort"), null);
	assert.equal(figures.get("limit"), null);
});

test("the by-type query is the figures query without the transaction type", () => {
	const searchParams = new URLSearchParams(
		"months=3&bucket=2026-W33&category=dining&transactionType=card&creditDebitIndicator=debit&amountMin=10"
	);
	const byType = buildByTypeQuery(searchParams, NOW, "2026-W33");
	assert.equal(byType.get("transactionType"), null);
	assert.equal(byType.get("category"), null);
	assert.equal(byType.get("fromDateTime"), "2026-08-10T00:00:00.000Z");
	assert.equal(byType.get("toDateTime"), "2026-08-17T00:00:00.000Z");
	assert.equal(byType.get("creditDebitIndicator"), "debit");
	assert.equal(byType.get("amountMin"), "1000");
});

test("the usual query reads the last 12 months with the shared filters, whatever the period, bucket or category", () => {
	const searchParams = new URLSearchParams(
		"months=1&bucket=2026-10-05&category=dining&transactionType=card&creditDebitIndicator=debit&amountMin=10&amountMax=500&sort=occurredAt&limit=25"
	);
	assert.deepEqual(Object.fromEntries(buildUsualQuery(searchParams, NOW)), {
		fromDateTime: "2025-10-19T10:00:00.000Z",
		toDateTime: "2026-10-19T10:00:00.000Z",
		transactionType: "card",
		creditDebitIndicator: "debit",
		amountMin: "1000",
		amountMax: "50000"
	});
});

test("the first bucket of a period is clipped at the period start", () => {
	const searchParams = new URLSearchParams("months=3");
	assert.deepEqual(buildSelectedWindow(searchParams, NOW, "2026-07"), {
		fromDateTime: "2026-07-19T10:00:00.000Z",
		toDateTime: "2026-08-01T00:00:00.000Z"
	});
	const list = buildListQuery(searchParams, NOW, "2026-07");
	assert.equal(list.get("fromDateTime"), "2026-07-19T10:00:00.000Z");
	const figures = buildFiguresQuery(searchParams, NOW, "2026-07");
	assert.equal(figures.get("fromDateTime"), "2026-07-19T10:00:00.000Z");
});

test("a middle bucket of a period keeps its whole window", () => {
	assert.deepEqual(
		buildSelectedWindow(new URLSearchParams("months=3"), NOW, "2026-08"),
		{
			fromDateTime: "2026-08-01T00:00:00.000Z",
			toDateTime: "2026-09-01T00:00:00.000Z"
		}
	);
});

test("no selected bucket gives the period", () => {
	assert.deepEqual(
		buildSelectedWindow(new URLSearchParams("months=3"), NOW, undefined),
		{
			fromDateTime: "2026-07-19T10:00:00.000Z",
			toDateTime: "2026-10-19T10:00:00.000Z"
		}
	);
});

test("the list query carries category, type, direction, sort, limit and a given cursor", () => {
	const searchParams = new URLSearchParams(
		"category=dining&transactionType=card&creditDebitIndicator=debit&sort=occurredAt&limit=25"
	);
	const query = buildListQuery(searchParams, NOW, undefined, "abc");
	assert.equal(query.get("category"), "dining");
	assert.equal(query.get("transactionType"), "card");
	assert.equal(query.get("creditDebitIndicator"), "debit");
	assert.equal(query.get("sort"), "occurredAt");
	assert.equal(query.get("limit"), "25");
	assert.equal(query.get("cursor"), "abc");
	const withoutCursor = buildListQuery(new URLSearchParams(""), NOW, undefined);
	assert.equal(withoutCursor.get("cursor"), null);
	assert.equal(withoutCursor.get("sort"), null);
	assert.equal(withoutCursor.get("limit"), "10");
});

test("the amount range goes to the API in minor units, and bad values are dropped", () => {
	const searchParams = new URLSearchParams("amountMin=99,50&amountMax=abc");
	for (const query of [
		buildListQuery(searchParams, NOW, undefined),
		buildFiguresQuery(searchParams, NOW, undefined),
		buildChartQuery(searchParams, NOW, "month")
	]) {
		assert.equal(query.get("amountMin"), "9950");
		assert.equal(query.get("amountMax"), null);
	}
});

test("changing the period drops the bucket, interval and open detail", () => {
	const searchParams = new URLSearchParams(
		"months=12&interval=week&bucket=2026-W33&category=dining&open=tx-1"
	);
	const params = readHrefParams(buildFilterHref(searchParams, "months", "3"));
	assert.equal(params.get("months"), "3");
	assert.equal(params.get("bucket"), null);
	assert.equal(params.get("interval"), null);
	assert.equal(params.get("open"), null);
	assert.equal(params.get("category"), "dining");
});

test("changing the interval drops the bucket but keeps the period", () => {
	const searchParams = new URLSearchParams(
		"months=3&interval=week&bucket=2026-W33&open=tx-1"
	);
	const params = readHrefParams(
		buildFilterHref(searchParams, "interval", "month")
	);
	assert.equal(params.get("interval"), "month");
	assert.equal(params.get("months"), "3");
	assert.equal(params.get("bucket"), null);
	assert.equal(params.get("open"), null);
});

test("changing the order keeps the selections and the amount range; an empty value removes the name", () => {
	const searchParams = new URLSearchParams(
		"bucket=2026-08&category=dining&amountMin=10&open=tx-1&sort=occurredAt"
	);
	const params = readHrefParams(
		buildFilterHref(searchParams, "sort", "-occurredAt")
	);
	assert.equal(params.get("sort"), "-occurredAt");
	assert.equal(params.get("bucket"), "2026-08");
	assert.equal(params.get("category"), "dining");
	assert.equal(params.get("amountMin"), "10");
	assert.equal(params.get("open"), null);
	const cleared = readHrefParams(buildFilterHref(searchParams, "sort", ""));
	assert.equal(cleared.get("sort"), null);
});

test("toggling selects, deselects on the same value, swaps on a different one, and drops open", () => {
	const empty = new URLSearchParams("months=3&open=tx-1");
	const selected = readHrefParams(buildToggleHref(empty, "bucket", "2026-08"));
	assert.equal(selected.get("bucket"), "2026-08");
	assert.equal(selected.get("open"), null);
	assert.equal(selected.get("months"), "3");
	const deselected = readHrefParams(
		buildToggleHref(new URLSearchParams("bucket=2026-08"), "bucket", "2026-08")
	);
	assert.equal(deselected.get("bucket"), null);
	const swapped = readHrefParams(
		buildToggleHref(new URLSearchParams("category=dining"), "category", "fuel")
	);
	assert.equal(swapped.get("category"), "fuel");
});

test("changing the grouping sets group and keeps the period and the open detail", () => {
	const searchParams = new URLSearchParams("months=3&open=tx-1");
	const params = readHrefParams(buildFilterHref(searchParams, "group", "type"));
	assert.equal(params.get("group"), "type");
	assert.equal(params.get("months"), "3");
	assert.equal(params.get("open"), "tx-1");
});

test("the usual month is read on the Category tab under 12 months with no bucket picked", () => {
	const cases = [
		{ query: "months=3", months: 3, selectedBucket: undefined, expected: true },
		{
			query: "months=1&group=category",
			months: 1,
			selectedBucket: undefined,
			expected: true
		},
		{
			query: "months=3&group=type",
			months: 3,
			selectedBucket: undefined,
			expected: false
		},
		{
			query: "months=12",
			months: 12,
			selectedBucket: undefined,
			expected: false
		},
		{
			query: "months=3&bucket=2026-08",
			months: 3,
			selectedBucket: "2026-08",
			expected: false
		}
	];
	for (const usualCase of cases) {
		assert.equal(
			isUsualRead(
				new URLSearchParams(usualCase.query),
				usualCase.months,
				usualCase.selectedBucket
			),
			usualCase.expected,
			usualCase.query
		);
	}
});

test("the spending is grouped by type only when the URL says so", () => {
	assert.equal(isGroupedByType(new URLSearchParams("group=type")), true);
	assert.equal(isGroupedByType(new URLSearchParams("months=3")), false);
});

test("toggling a transaction type selects it, deselects it on the same value, and drops open", () => {
	const searchParams = new URLSearchParams("months=3&open=tx-1");
	const selected = readHrefParams(
		buildToggleHref(searchParams, "transactionType", "card")
	);
	assert.equal(selected.get("transactionType"), "card");
	assert.equal(selected.get("months"), "3");
	assert.equal(selected.get("open"), null);
	const deselected = readHrefParams(
		buildToggleHref(
			new URLSearchParams("transactionType=card&open=tx-1"),
			"transactionType",
			"card"
		)
	);
	assert.equal(deselected.get("transactionType"), null);
	assert.equal(deselected.get("open"), null);
});

test("clear all removes the filters and the open detail, and keeps months, interval, sort and limit", () => {
	const searchParams = new URLSearchParams(
		"months=3&interval=week&sort=occurredAt&limit=25&bucket=2026-W33&category=dining&transactionType=card&creditDebitIndicator=debit&amountMin=1&amountMax=2&open=tx-1"
	);
	assert.equal(
		buildClearAllHref(searchParams),
		"/overview?months=3&interval=week&sort=occurredAt&limit=25"
	);
});

test("an amount bound or a bucket on its own is a filter; the period and order are not", () => {
	assert.equal(hasFilters(new URLSearchParams("amountMin=10")), true);
	assert.equal(hasFilters(new URLSearchParams("bucket=2026-08")), true);
	assert.equal(
		hasFilters(new URLSearchParams("months=3&sort=occurredAt")),
		false
	);
	assert.equal(hasFilters(new URLSearchParams("category=")), false);
});

test("a bucket on its own is not a filter beside the bucket; anything else is", () => {
	assert.equal(
		hasFiltersBesideBucket(new URLSearchParams("months=3&bucket=2026-08")),
		false
	);
	assert.equal(
		hasFiltersBesideBucket(
			new URLSearchParams("bucket=2026-08&transactionType=card")
		),
		true
	);
	assert.equal(
		hasFiltersBesideBucket(new URLSearchParams("category=dining")),
		true
	);
});

test("the amount range href sets both bounds and drops open", () => {
	const params = new URLSearchParams("open=tx-1");
	const set = readHrefParams(buildAmountRangeHref(params, "10", "20,50"));
	assert.equal(set.get("amountMin"), "10");
	assert.equal(set.get("amountMax"), "20,50");
	assert.equal(set.get("open"), null);
	const cleared = readHrefParams(
		buildAmountRangeHref(
			new URLSearchParams("amountMin=10&amountMax=20"),
			"",
			""
		)
	);
	assert.equal(cleared.get("amountMin"), null);
	assert.equal(cleared.get("amountMax"), null);
});

test("opening or closing a detail keeps everything else", () => {
	const params = new URLSearchParams("months=3&bucket=2026-08&category=dining");
	const opened = readHrefParams(buildOpenHref(params, "tx-2"));
	assert.equal(opened.get("open"), "tx-2");
	assert.equal(opened.get("months"), "3");
	assert.equal(opened.get("bucket"), "2026-08");
	assert.equal(opened.get("category"), "dining");
	const closed = readHrefParams(
		buildOpenHref(new URLSearchParams("months=3&open=tx-2"), undefined)
	);
	assert.equal(closed.get("open"), null);
	assert.equal(closed.get("months"), "3");
});

test("reads the open transaction id from the URL", () => {
	assert.equal(readOpenTransactionId(new URLSearchParams("open=tx-1")), "tx-1");
	assert.equal(readOpenTransactionId(new URLSearchParams("open=")), undefined);
	assert.equal(readOpenTransactionId(new URLSearchParams("")), undefined);
});

test("page size accepts 100", () => {
	assert.equal(readPageSize("100"), "100");
	assert.equal(readPageSize("7"), "10");
});
