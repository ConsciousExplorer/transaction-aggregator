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
			transactionType: "card",
			direction: "debit",
			status: "completed",
			amountMinor: 1234,
			currency: "ZAR",
			category: "groceries",
			shortDescription: "Spar",
			cursorOccurredAt: "2026-08-15T09:30:00.000123Z"
		},
		{
			transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
			occurredAt: "2026-08-14T12:00:00.000Z",
			transactionType: "eft",
			direction: "credit",
			status: "reversed",
			amountMinor: 50000,
			currency: "ZAR",
			category: "salary",
			shortDescription: null,
			cursorOccurredAt: "2026-08-14T12:00:00.000000Z"
		}
	];

// The detail select carries account/external/posted/description/mcc/metadata
// on top of the list columns — its own typed fixture keeps the drift guard
// honest. metadata matches what apps/consumer/src/domain/normaliser/domain/
// card.ts actually writes (camelCase keys — see schemas/transactions.ts's
// mapFundingSource, which parses this shape).
const DETAIL: Awaited<
	ReturnType<UserTransactionRepository["getTransactionDetail"]>
> = {
	transactionId: TX_ID,
	accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	externalId: "ext-card-001",
	occurredAt: "2026-08-15T09:30:00.000Z",
	transactionType: "card",
	direction: "debit",
	status: "completed",
	longDescription: null,
	amountMinor: 1234,
	currency: "ZAR",
	categoryId: 1,
	category: "groceries",
	shortDescription: "Spar",
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

	test("200: list maps rows to the wire shape, non-completed statuses included", async () => {
		const res = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{
					transactionId: TX_ID,
					occurredAt: "2026-08-15T09:30:00.000Z",
					transactionType: "card",
					direction: "debit",
					status: "completed",
					amountMinor: 1234,
					currency: "ZAR",
					category: "groceries",
					shortDescription: "Spar"
				},
				{
					transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
					occurredAt: "2026-08-14T12:00:00.000Z",
					transactionType: "eft",
					direction: "credit",
					status: "reversed",
					amountMinor: 50000,
					currency: "ZAR",
					category: "salary",
					shortDescription: null
				}
			],
			links: { self: LIST_URL, next: null, prev: null },
			meta: {
				count: 2,
				limit: 50,
				fromDateTime: FROM,
				toDateTime: TO,
				nextCursor: null,
				prevCursor: null
			}
		});
	});

	test("handler maps params/query onto the repository filter (limit 50 + one look-ahead row)", async () => {
		await app.inject({
			method: "GET",
			url: `${LIST_URL}&category=groceries&transactionType=card`
		});
		assert.strictEqual(getTransactions.mock.callCount(), 1);
		assert.deepStrictEqual(getTransactions.mock.calls[0]?.arguments.at(0), {
			userId: "u1",
			fromDateTime: FROM,
			toDateTime: TO,
			transactionType: "card",
			category: "groceries",
			direction: undefined,
			amountMin: undefined,
			amountMax: undefined,
			cursorOccurredAt: undefined,
			cursorTransactionId: undefined,
			cursorDirection: "next",
			limit: 51
		});
	});

	test("200: a full page returns limit rows and a cursor from the last one", async () => {
		// limit=1 and the repository returns 2 rows: the look-ahead row proves
		// another page exists and is not returned.
		const res = await app.inject({ method: "GET", url: `${LIST_URL}&limit=1` });
		assert.strictEqual(res.statusCode, 200);

		const body = res.json();
		assert.strictEqual(body.data.length, 1);
		assert.strictEqual(body.data[0].transactionId, TX_ID);
		assert.strictEqual(body.meta.count, 1);
		assert.strictEqual(body.meta.limit, 1);
		assert.deepStrictEqual(body.meta.nextCursor, {
			occurredAt: "2026-08-15T09:30:00.000123Z",
			transactionId: TX_ID
		});

		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.pathname, "/api/v1/users/u1/transactions");
		assert.strictEqual(next.searchParams.get("fromDateTime"), FROM);
		assert.strictEqual(next.searchParams.get("toDateTime"), TO);
		assert.strictEqual(next.searchParams.get("limit"), "1");
		assert.strictEqual(
			next.searchParams.get("cursorOccurredAt"),
			"2026-08-15T09:30:00.000123Z"
		);
		assert.strictEqual(next.searchParams.get("cursorTransactionId"), TX_ID);
	});

	test("the next link keeps every filter as sent and replaces the previous cursor", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&transactionType=card&transactionType=eft&limit=1&cursorOccurredAt=2026-09-01T00:00:00.000000Z&cursorTransactionId=9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f`
		});
		assert.strictEqual(res.statusCode, 200);

		const next = new URL(res.json().links.next, "http://client.example");
		assert.deepStrictEqual(next.searchParams.getAll("transactionType"), [
			"card",
			"eft"
		]);
		assert.deepStrictEqual(next.searchParams.getAll("cursorOccurredAt"), [
			"2026-08-15T09:30:00.000123Z"
		]);
		assert.deepStrictEqual(next.searchParams.getAll("cursorTransactionId"), [
			TX_ID
		]);
	});

	test("the cursor pair from nextCursor is forwarded as the keyset bound", async () => {
		await app.inject({
			method: "GET",
			url: `${LIST_URL}&cursorOccurredAt=2026-08-15T09:30:00.000123Z&cursorTransactionId=${TX_ID}`
		});
		const filter = getTransactions.mock.calls[0]?.arguments.at(0) as
			| { cursorOccurredAt?: string; cursorTransactionId?: string }
			| undefined;
		assert.strictEqual(filter?.cursorOccurredAt, "2026-08-15T09:30:00.000123Z");
		assert.strictEqual(filter?.cursorTransactionId, TX_ID);
	});

	test("400: one cursor field without the other, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&cursorTransactionId=${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getTransactions.mock.callCount(), 0);
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
			status: "completed",
			amount: { amountMinor: 1234, currency: "ZAR" },
			longDescription: null,
			shortDescription: "Spar",
			category: "groceries",
			fundingSource: {
				transactionType: "card",
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

	test("a page reached through next links back with prev from its first row", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&limit=1&cursorOccurredAt=2026-09-01T00:00:00.000000Z&cursorTransactionId=${TX_ID}`
		});
		const body = res.json();

		assert.strictEqual(
			body.links.self,
			`${LIST_URL}&limit=1&cursorOccurredAt=2026-09-01T00:00:00.000000Z&cursorTransactionId=${TX_ID}`
		);
		assert.deepStrictEqual(body.meta.prevCursor, {
			occurredAt: "2026-08-15T09:30:00.000123Z",
			transactionId: TX_ID
		});

		const prev = new URL(body.links.prev, "http://client.example");
		assert.strictEqual(prev.searchParams.get("cursorDirection"), "prev");
		assert.strictEqual(
			prev.searchParams.get("cursorOccurredAt"),
			"2026-08-15T09:30:00.000123Z"
		);
	});

	test("a prev page is read upwards and served newest first", async () => {
		// Upwards from the cursor the repository returns oldest first
		getTransactions.mock.mockImplementationOnce(async () =>
			[...ROWS].reverse()
		);

		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&cursorOccurredAt=2026-08-01T00:00:00.000000Z&cursorTransactionId=${TX_ID}&cursorDirection=prev`
		});
		const body = res.json();

		const filter = getTransactions.mock.calls[0]?.arguments.at(0) as
			| { cursorDirection?: string }
			| undefined;
		assert.strictEqual(filter?.cursorDirection, "prev");
		assert.deepStrictEqual(
			body.data.map((row: { transactionId: string }) => row.transactionId),
			[TX_ID, "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f"],
			"newest first, like every other page"
		);
		// Not full, so nothing newer; came from an older page, so next exists
		assert.strictEqual(body.links.prev, null);
		assert.deepStrictEqual(body.meta.nextCursor, {
			occurredAt: "2026-08-14T12:00:00.000000Z",
			transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f"
		});
	});
});
