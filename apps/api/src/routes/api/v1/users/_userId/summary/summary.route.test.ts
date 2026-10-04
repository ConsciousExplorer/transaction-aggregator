// src/routes/api/v1/users/_userId/summary/summary.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";
import { buildServer } from "#src/server.ts";
import summaryRoute from "./summary.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";
const BASE_URL = `/api/v1/users/${USER_ID}/summary?fromDateTime=${FROM}&toDateTime=${TO}`;
// links.self is the request with the window as read; ":" stays unencoded
const BASE_SELF = `/api/v1/users/${USER_ID}/summary?fromDateTime=${FROM}&toDateTime=${TO}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const zar = (amountMinor: number) => ({ amountMinor, currency: "ZAR" });

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

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getUserSummary = mock.fn(async () => ROWS);
const summaryRepository = {
	dbClient: {} as Pool,
	getUserSummary
} satisfies SummaryRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("GET /api/v1/users/:userId/summary", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(summaryRoute, {
			prefix: "/api/v1/users/:userId/summary",
			summaryRepository,
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
	});

	test("200: totals aggregate the rows and data carries the per-group breakdown", async () => {
		const res = await app.inject({ method: "GET", url: BASE_URL });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			totals: {
				transactionCount: 4,
				// credit − debit: (500−1500) + (0−700); the currency comes from the rows
				netAmount: zar(-1700),
				debit: { count: 3, total: zar(2200) },
				credit: { count: 1, total: zar(500) }
			},
			data: [
				{
					group: { category: "groceries" },
					count: 3,
					netAmount: zar(-1000),
					debit: { count: 2, total: zar(1500) },
					credit: { count: 1, total: zar(500) }
				},
				{
					group: { category: "dining" },
					count: 1,
					netAmount: zar(-700),
					debit: { count: 1, total: zar(700) },
					credit: { count: 0, total: zar(0) }
				}
			],
			links: { self: BASE_SELF },
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
			fromDate: FROM,
			toDate: TO,
			accountId: undefined,
			category: undefined,
			interval: "month"
		});
	});

	test("accountId narrows the summary to that account", async () => {
		await app.inject({
			method: "GET",
			url: `${BASE_URL}&accountId=5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a`
		});
		const filter = getUserSummary.mock.calls[0]?.arguments.at(0) as
			| { accountId?: unknown }
			| undefined;
		assert.strictEqual(
			filter?.accountId,
			"5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a"
		);
	});

	test("400: an accountId that isn't a UUID → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${BASE_URL}&accountId=not-a-uuid`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: missing required query → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: a userId that isn't a UUID → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/not-a-uuid/summary?fromDateTime=${FROM}&toDateTime=${TO}`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("400: a window wider than 366 days is rejected before the query runs", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:01.000Z`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.deepStrictEqual(res.json(), {
			type: "window-too-large",
			title: "Time window too large",
			status: 400,
			detail: "fromDateTime to toDateTime may span at most 366 days"
		});
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
	});

	test("a future toDateTime is read as now, and the window is measured from there", async () => {
		// 300 days back to 2099 is far over the cap; 300 days back to now is not
		const fromDateTime = new Date(Date.now() - 300 * DAY_MS).toISOString();
		const before = Date.now();
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z`
		});
		const after = Date.now();

		assert.strictEqual(res.statusCode, 200);
		const filter = getUserSummary.mock.calls[0]?.arguments.at(0) as
			| { fromDate: string; toDate: string }
			| undefined;
		assert.strictEqual(filter?.fromDate, fromDateTime);
		const toDate = Date.parse(filter?.toDate ?? "");
		assert.ok(toDate >= before && toDate <= after);
		assert.strictEqual(res.json().meta.toDateTime, filter?.toDate);
		const self = new URL(res.json().links.self, "http://client.example");
		assert.strictEqual(self.searchParams.get("toDateTime"), filter?.toDate);
	});

	test("200: twelve calendar months across a leap day (366 days) are allowed", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/summary?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:00.000Z`
		});
		assert.strictEqual(res.statusCode, 200);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getUserSummary.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({ method: "GET", url: BASE_URL });
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
