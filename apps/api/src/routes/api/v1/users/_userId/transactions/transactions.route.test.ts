// src/routes/api/v1/users/_userId/transactions/transactions.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import transactionsRoute from "./transactions.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const TX_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const LIST_URL = `/api/v1/users/u1/transactions?fromDateTime=${FROM}&toDateTime=${TO}`;

// Typed off the real methods so drift in the select shape breaks compilation.
const ROWS: Awaited<ReturnType<UserTransactionRepository["getTransactions"]>> =
	[
		{
			transactionId: TX_ID,
			occurredAt: "2026-08-15T09:30:00.000Z",
			source: "card",
			direction: "debit",
			amountMinor: 1234,
			currency: "ZAR",
			category: "groceries",
			counterpartyName: "Spar"
		},
		{
			transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
			occurredAt: "2026-08-14T12:00:00.000Z",
			source: "eft",
			direction: "credit",
			amountMinor: 50000,
			currency: "ZAR",
			category: "salary",
			counterpartyName: null
		}
	];

// The detail select carries account/external/posted/description/mcc/metadata
// on top of the list columns — its own typed fixture keeps the drift guard
// honest. metadata matches what apps/consumer/src/domain/normaliser/domain/
// card.ts actually writes (camelCase keys — see transaction-repository.ts's
// mapSourceDetail, which parses this shape).
const DETAIL: Awaited<
	ReturnType<UserTransactionRepository["getTransactionDetail"]>
> = {
	transactionId: TX_ID,
	accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	externalId: "ext-card-001",
	occurredAt: "2026-08-15T09:30:00.000Z",
	postedAt: null,
	source: "card",
	direction: "debit",
	description: null,
	amountMinor: 1234,
	currency: "ZAR",
	categoryId: 1,
	category: "groceries",
	mcc: "5411",
	counterpartyName: "Spar",
	metadata: {
		mcc: "5411",
		merchantName: "Spar",
		cardLast4: "1234",
		cardNetwork: "visa",
		posEntryMode: "chip",
		authCode: "A1B2C3"
	}
};

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getTransactions = mock.fn(async () => ROWS);
const getTransactionDetail = mock.fn(async () => DETAIL);
const transactionRepository = {
	dbClient: {} as Pool,
	getTransactions,
	getTransactionDetail,
	setTransactionCategory: mock.fn(async () => undefined),
	archiveTransactionCategory: mock.fn(async () => undefined)
} satisfies UserTransactionRepository;

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
		getTransactions.mock.resetCalls();
		getTransactions.mock.mockImplementation(async () => ROWS);
		getTransactionDetail.mock.resetCalls();
		getTransactionDetail.mock.mockImplementation(async () => DETAIL);
	});

	test("200: list maps rows to the wire shape (transactionId, ISO occurredAt)", async () => {
		const res = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{
					transactionId: TX_ID,
					occurredAt: "2026-08-15T09:30:00.000Z",
					source: "card",
					direction: "debit",
					amountMinor: 1234,
					currency: "ZAR",
					category: "groceries",
					counterpartyName: "Spar"
				},
				{
					transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
					occurredAt: "2026-08-14T12:00:00.000Z",
					source: "eft",
					direction: "credit",
					amountMinor: 50000,
					currency: "ZAR",
					category: "salary",
					counterpartyName: null
				}
			],
			nextCursor: null
		});
	});

	test("handler maps params/query onto the repository filter (limit defaults to 50)", async () => {
		await app.inject({ method: "GET", url: `${LIST_URL}&category=groceries` });
		assert.strictEqual(getTransactions.mock.callCount(), 1);
		assert.deepStrictEqual(getTransactions.mock.calls[0]?.arguments.at(0), {
			userId: "u1",
			fromDateTime: FROM,
			toDateTime: TO,
			category: "groceries",
			direction: undefined,
			amountMin: undefined,
			amountMax: undefined,
			cursorOccurredAt: undefined,
			cursorTransactionId: undefined,
			limit: 50
		});
	});

	test("200: detail maps the row to the wire shape, source as a typed union", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/u1/transactions/${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			transactionId: TX_ID,
			accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
			externalId: "ext-card-001",
			occurredAt: "2026-08-15T09:30:00.000Z",
			direction: "debit",
			amount: { amountMinor: 1234, currency: "ZAR" },
			description: null,
			mcc: "5411",
			counterpartyName: "Spar",
			category: "groceries",
			source: {
				sourceType: "card",
				cardLast4: "1234",
				cardNetwork: "visa",
				mcc: "5411",
				merchantName: "Spar",
				posEntryMode: "chip",
				authCode: "A1B2C3"
			}
		});
		assert.deepStrictEqual(
			getTransactionDetail.mock.calls[0]?.arguments.at(0),
			{ userId: "u1", transactionId: TX_ID }
		);
	});

	test("404: unknown transaction → not-found problem", async () => {
		// Runtime a missing row yields undefined; the mock's inferred type doesn't.
		getTransactionDetail.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof DETAIL
		);
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/u1/transactions/${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 404);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "not-found");
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getTransactions.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
