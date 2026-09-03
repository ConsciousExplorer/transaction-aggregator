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
const BASE_URL = `/api/v1/users/u1/summary?fromDateTime=${FROM}&toDateTime=${TO}`;

// Typed off the real method so drift in the select shape breaks compilation.
const ROWS: Awaited<ReturnType<SummaryRepository["getUserSummary"]>> = [
	{
		bucketStart: FROM,
		category: "groceries",
		currency: "ZAR",
		count: 3,
		netAmount: 2000,
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
		netAmount: 700,
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
			summaryRepository
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
				currency: "ZAR", // taken from the rows — single-currency assumption
				transactionCount: 4,
				netAmount: 1700, // (1500−500) + (700−0)
				debit: { count: 3, total: 2200 },
				credit: { count: 1, total: 500 }
			},
			data: [
				{
					group: { category: "groceries" },
					currency: "ZAR",
					count: 3,
					netAmount: 1000,
					debit: { count: 2, total: 1500 },
					credit: { count: 1, total: 500 }
				},
				{
					group: { category: "dining" },
					currency: "ZAR",
					count: 1,
					netAmount: 700,
					debit: { count: 1, total: 700 },
					credit: { count: 0, total: 0 }
				}
			],
			meta: {
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
			userId: "u1",
			fromDate: FROM,
			toDate: TO,
			category: undefined,
			interval: "month"
		});
	});

	test("400: missing required query → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/users/u1/summary"
		});
		assert.strictEqual(res.statusCode, 400);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:validation-error");
		assert.strictEqual(getUserSummary.mock.callCount(), 0);
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
		assert.strictEqual(res.json().type, "urn:api:problem:internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
