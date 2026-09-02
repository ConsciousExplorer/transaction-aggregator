// src/routes/api/v1/users/_userId/transactions/transactions.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import transactionsRoute from "./transactions.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const TX_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const LIST_URL = `/api/v1/users/u1/transactions?fromDateTime=${FROM}&toDateTime=${TO}`;

// Typed off the real methods so drift in the select shape breaks compilation.
const ROWS: Awaited<ReturnType<TransactionRepository["getUserTransactions"]>> =
	[
		{
			transactionId: TX_ID,
			occurredAt: "2026-08-15T09:30:00.000Z",
			source: "card",
			direction: "debit",
			amountMinor: 1234,
			currency: "ZAR",
			category: "groceries",
			merchantName: "Spar"
		},
		{
			transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
			occurredAt: "2026-08-14T12:00:00.000Z",
			source: "eft",
			direction: "credit",
			amountMinor: 50000,
			currency: "ZAR",
			category: "salary",
			merchantName: null
		}
	];

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getUserTransactions = mock.fn(async () => ROWS);
const getUserTransactionDetail = mock.fn(async () => ROWS[0]);
const transactionRepository = {
	dbClient: {} as Pool,
	getUserTransactions,
	getUserTransactionDetail,
	upsertUserTransactionCategory: mock.fn(async () => undefined)
} satisfies TransactionRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("GET /api/v1/users/:userId/transactions", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(transactionsRoute, {
			prefix: "/api/v1/users/:userId/transactions",
			transactionRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		getUserTransactions.mock.resetCalls();
		getUserTransactions.mock.mockImplementation(async () => ROWS);
		getUserTransactionDetail.mock.resetCalls();
		getUserTransactionDetail.mock.mockImplementation(async () => ROWS[0]);
	});

	test("200: list maps rows to the wire shape (id, ISO occurredAt)", async () => {
		const res = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{
					id: TX_ID,
					occurredAt: "2026-08-15T09:30:00.000Z",
					source: "card",
					direction: "debit",
					amountMinor: 1234,
					currency: "ZAR",
					category: "groceries",
					merchantName: "Spar"
				},
				{
					id: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
					occurredAt: "2026-08-14T12:00:00.000Z",
					source: "eft",
					direction: "credit",
					amountMinor: 50000,
					currency: "ZAR",
					category: "salary",
					merchantName: null
				}
			],
			nextCursor: null
		});
		assert.ok(!res.body.includes("transactionId"));
	});

	test("handler maps params/query onto the repository filter (limit defaults to 50)", async () => {
		await app.inject({ method: "GET", url: `${LIST_URL}&category=groceries` });
		assert.strictEqual(getUserTransactions.mock.callCount(), 1);
		assert.deepStrictEqual(getUserTransactions.mock.calls[0]?.arguments.at(0), {
			userId: "u1",
			fromDate: FROM,
			toDate: TO,
			category: "groceries",
			direction: undefined,
			amountMin: undefined,
			amountMax: undefined,
			cursorOccurredAt: undefined,
			cursorTransactionId: undefined,
			limit: 50
		});
	});

	test("200: detail maps the row to the wire shape", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/u1/transactions/${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			id: TX_ID,
			occurredAt: "2026-08-15T09:30:00.000Z",
			source: "card",
			direction: "debit",
			amountMinor: 1234,
			currency: "ZAR",
			category: "groceries",
			merchantName: "Spar"
		});
		assert.deepStrictEqual(
			getUserTransactionDetail.mock.calls[0]?.arguments.at(0),
			{ userId: "u1", transactionId: TX_ID }
		);
	});

	test("404: unknown transaction → not-found problem", async () => {
		getUserTransactionDetail.mock.mockImplementationOnce(async () => undefined);
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/u1/transactions/${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 404);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:not-found");
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getUserTransactions.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
