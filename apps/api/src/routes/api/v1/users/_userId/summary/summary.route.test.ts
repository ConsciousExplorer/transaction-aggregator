import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance, RouteOptions } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";
import { buildServer } from "#src/server.ts";
import registerSummaryRoute from "./summary.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";
const BASE_URL = `/api/v1/users/${USER_ID}/summary?fromDateTime=${FROM}&toDateTime=${TO}`;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function buildAmount(amountMinor: number) {
	return { amountMinor, currency: "ZAR" };
}

// Typed off the real method so drift in the select shape breaks compilation.
const ROWS: Awaited<ReturnType<SummaryRepository["getUserSummary"]>> = [
	{
		bucketStart: FROM,
		category: "groceries",
		currency: "ZAR",
		count: 3,
		debitCount: 2,
		creditCount: 1,
		debitAmount: 1500,
		creditAmount: 500
	},
	{
		bucketStart: FROM,
		category: "dining",
		currency: "ZAR",
		count: 1,
		debitCount: 1,
		creditCount: 0,
		debitAmount: 700,
		creditAmount: 0
	}
];

// `satisfies` is the drift guard: the fake must match the real methods the
// route calls, so a change to one of their signatures stops this compiling.
const getUserSummary = mock.fn<SummaryRepository["getUserSummary"]>(
	async () => ROWS
);
const summaryRepository = {
	getUserSummary
} satisfies Pick<SummaryRepository, "getUserSummary">;

// Every slug names a category unless a test says otherwise
const findUnknownCategories = mock.fn<
	CategoryRepository["findUnknownCategories"]
>(async () => []);
const categoryRepository = {
	findUnknownCategories
} satisfies Pick<CategoryRepository, "findUnknownCategories">;

suite("GET /api/v1/users/:userId/summary", () => {
	let app: FastifyInstance;
	const routes: RouteOptions[] = [];

	before(async () => {
		app = buildServer({});
		app.addHook("onRoute", (route) => {
			routes.push(route);
		});
		await app.register(registerSummaryRoute, {
			prefix: "/api/v1/users/:userId/summary",
			summaryRepository,
			categoryRepository,
			queryWindow: { maxDays: 366 }
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		getUserSummary.mock.resetCalls();
		getUserSummary.mock.mockImplementation(async () => ROWS);
		findUnknownCategories.mock.resetCalls();
		findUnknownCategories.mock.mockImplementation(async () => []);
	});

	// The read would match nothing: zero totals that read as no spending
	test("400: an unknown category slug → validation problem, nothing read", async () => {
		findUnknownCategories.mock.mockImplementationOnce(async () => ["grocery"]);
		const response = await app.inject({
			method: "GET",
			url: `${BASE_URL}&category=grocery`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.deepStrictEqual(findUnknownCategories.mock.calls[0]?.arguments, [
			["grocery"]
		]);
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("200: totals aggregate the rows and data carries the per-group breakdown", async () => {
		const response = await app.inject({ method: "GET", url: BASE_URL });
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			totals: {
				transactionCount: 4,
				// credit − debit: (500−1500) + (0−700); the currency comes from the rows
				netAmount: buildAmount(-1700),
				debit: { count: 3, total: buildAmount(2200) },
				credit: { count: 1, total: buildAmount(500) }
			},
			data: [
				{
					group: { category: "groceries" },
					count: 3,
					netAmount: buildAmount(-1000),
					debit: { count: 2, total: buildAmount(1500) },
					credit: { count: 1, total: buildAmount(500) }
				},
				{
					group: { category: "dining" },
					count: 1,
					netAmount: buildAmount(-700),
					debit: { count: 1, total: buildAmount(700) },
					credit: { count: 0, total: buildAmount(0) }
				}
			],
			links: { self: BASE_URL },
			meta: {
				count: 2,
				fromDateTime: FROM,
				toDateTime: TO,
				groupBy: ["Category"]
			}
		});
	});

	test("handler maps params/query onto the repository filter", async () => {
		await app.inject({ method: "GET", url: `${BASE_URL}&interval=month` });
		assert.strictEqual(getUserSummary.mock.callCount(), 1);
		assert.deepStrictEqual(getUserSummary.mock.calls[0]?.arguments.at(0), {
			userId: USER_ID,
			fromDateTime: FROM,
			toDateTime: TO,
			accountId: undefined,
			transactionType: undefined,
			category: undefined,
			creditDebitIndicator: undefined,
			amountMin: undefined,
			amountMax: undefined,
			interval: "month"
		});
	});

	test("the list's filters reach the summary query", async () => {
		await app.inject({
			method: "GET",
			url: `${BASE_URL}&transactionType=card&transactionType=eft&creditDebitIndicator=debit&amountMin=100&amountMax=5000`
		});
		const filter = getUserSummary.mock.calls[0]?.arguments.at(0);
		assert.deepStrictEqual(filter?.transactionType, ["card", "eft"]);
		assert.strictEqual(filter?.creditDebitIndicator, "debit");
		assert.strictEqual(filter?.amountMin, 100);
		assert.strictEqual(filter?.amountMax, 5000);
	});

	test('400: interval "total" is not an interval; leaving it out is the whole window', async () => {
		const response = await app.inject({
			method: "GET",
			url: `${BASE_URL}&interval=total`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("accountId narrows the summary to that account", async () => {
		await app.inject({
			method: "GET",
			url: `${BASE_URL}&accountId=5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a`
		});
		const filter = getUserSummary.mock.calls[0]?.arguments.at(0);
		assert.strictEqual(
			filter?.accountId,
			"5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a"
		);
	});

	test("400: an accountId that isn't a UUID → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: `${BASE_URL}&accountId=not-a-uuid`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: missing required query → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.ok(
			String(response.headers["content-type"]).startsWith(
				"application/problem+json"
			)
		);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: a userId that isn't a UUID → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/not-a-uuid/summary?fromDateTime=${FROM}&toDateTime=${TO}`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: a window wider than 366 days is rejected before the query runs", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:01.000Z`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.deepStrictEqual(response.json(), {
			type: "window-too-large",
			title: "Time window too large",
			status: 400,
			detail: "fromDateTime to toDateTime may span at most 366 days"
		});
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("a future toDateTime is read as now, and the window is measured from there", async () => {
		// 300 days back to 2099 is far over the cap; 300 days back to now is not
		const fromDateTime = new Date(
			Date.now() - 300 * MILLISECONDS_PER_DAY
		).toISOString();
		const startedAt = Date.now();
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z`
		});
		const finishedAt = Date.now();

		assert.strictEqual(response.statusCode, 200);
		const filter = getUserSummary.mock.calls[0]?.arguments.at(0);
		assert.strictEqual(filter?.fromDateTime, fromDateTime);
		const clampedTo = Date.parse(filter?.toDateTime ?? "");
		assert.ok(clampedTo >= startedAt && clampedTo <= finishedAt);
		assert.strictEqual(response.json().meta.toDateTime, filter?.toDateTime);
		const self = new URL(response.json().links.self, "http://client.example");
		assert.strictEqual(self.searchParams.get("toDateTime"), filter?.toDateTime);
	});

	test("200: twelve calendar months across a leap day (366 days) are allowed", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:00.000Z`
		});
		assert.strictEqual(response.statusCode, 200);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getUserSummary.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({ method: "GET", url: BASE_URL });
		assert.strictEqual(response.statusCode, 500);
		assert.ok(
			String(response.headers["content-type"]).startsWith(
				"application/problem+json"
			)
		);
		assert.strictEqual(response.json().type, "internal");
		assert.ok(!response.body.includes("hunter2"));
	});

	test("the contract documents the 500 it can answer", () => {
		const route = routes.find((candidate) => candidate.method === "GET");
		const documented = Object.keys(route?.schema?.response ?? {});
		assert.ok(documented.includes("500"), `documents ${documented.join(", ")}`);
	});
});
