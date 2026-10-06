// src/routes/api/v1/users/_userId/transactions/transactions.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import transactionsRoute from "./transactions.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const TX_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";
const LIST_URL = `/api/v1/users/${USER_ID}/transactions?fromDateTime=${FROM}&toDateTime=${TO}`;
// links.self is the request with the window as read; ":" stays unencoded
const LIST_SELF = `/api/v1/users/${USER_ID}/transactions?fromDateTime=${FROM}&toDateTime=${TO}`;
const DAY_MS = 24 * 60 * 60 * 1000;

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
// a signature, this fake stops compiling. `db` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getTransactions = mock.fn(async () => ROWS);
const getTransactionDetail = mock.fn(async () => DETAIL);
const transactionRepository = {
	db: {} as NodePgDatabase,
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
			transactionRepository,
			queryWindow: { maxDays: 366 }
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
					amount: { amountMinor: 1234, currency: "ZAR" },
					category: "groceries",
					shortDescription: "Spar"
				},
				{
					transactionId: "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f",
					occurredAt: "2026-08-14T12:00:00.000Z",
					transactionType: "eft",
					direction: "credit",
					status: "reversed",
					amount: { amountMinor: 50000, currency: "ZAR" },
					category: "salary",
					shortDescription: null
				}
			],
			links: { self: LIST_SELF },
			meta: {
				count: 2,
				limit: 50,
				sort: "-occurredAt",
				fromDateTime: FROM,
				toDateTime: TO
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
			userId: USER_ID,
			fromDateTime: FROM,
			toDateTime: TO,
			accountId: undefined,
			transactionType: "card",
			category: "groceries",
			direction: undefined,
			amountMin: undefined,
			amountMax: undefined,
			sort: "-occurredAt",
			cursorOccurredAt: undefined,
			cursorTransactionId: undefined,
			cursorDirection: "next",
			limit: 51
		});
	});

	test("accountId narrows the list to those accounts, one or many", async () => {
		await app.inject({
			method: "GET",
			url: `${LIST_URL}&accountId=5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a&accountId=6f3a9b21-5c4d-4e2f-8a7b-8c9d0e1f2a3b`
		});
		const filter = getTransactions.mock.calls[0]?.arguments.at(0) as
			| { accountId?: unknown }
			| undefined;
		assert.deepStrictEqual(filter?.accountId, [
			"5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a",
			"6f3a9b21-5c4d-4e2f-8a7b-8c9d0e1f2a3b"
		]);
	});

	test("400: an accountId that isn't a UUID → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&accountId=not-a-uuid`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("sort=occurredAt reaches the repository and every link keeps it", async () => {
		const res = await app.inject({
			method: "GET",
			url: `${LIST_URL}&sort=occurredAt&limit=1`
		});
		assert.strictEqual(res.statusCode, 200);
		const filter = getTransactions.mock.calls[0]?.arguments.at(0) as
			| { sort?: string }
			| undefined;
		assert.strictEqual(filter?.sort, "occurredAt");

		const body = res.json();
		assert.strictEqual(body.meta.sort, "occurredAt");
		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.searchParams.get("sort"), "occurredAt");
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

		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.pathname, `/api/v1/users/${USER_ID}/transactions`);
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

	test("the cursor pair from links.next is forwarded as the keyset bound", async () => {
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

	test("400: a userId that isn't a UUID → validation problem, repository untouched", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/not-a-uuid/transactions?fromDateTime=${FROM}&toDateTime=${TO}`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("self, next and prev all carry the window as read, a future toDateTime as now", async () => {
		const fromDateTime = new Date(Date.now() - 80 * DAY_MS).toISOString();
		// A cursor page that comes back full has both neighbours
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z&limit=1&cursorOccurredAt=2026-09-01T00:00:00.000000Z&cursorTransactionId=${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 200);

		const body = res.json();
		assert.ok(Date.parse(body.meta.toDateTime) <= Date.now());
		for (const name of ["self", "next", "prev"]) {
			const link = new URL(body.links[name], "http://client.example");
			assert.strictEqual(
				link.searchParams.get("fromDateTime"),
				fromDateTime,
				name
			);
			assert.strictEqual(
				link.searchParams.get("toDateTime"),
				body.meta.toDateTime,
				name
			);
		}
	});

	test("400: a window wider than 366 days is rejected before the query runs", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:01.000Z`
		});
		assert.strictEqual(res.statusCode, 400);
		assert.deepStrictEqual(res.json(), {
			type: "window-too-large",
			title: "Time window too large",
			status: 400,
			detail: "fromDateTime to toDateTime may span at most 366 days"
		});
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("a future toDateTime is read as now, and the window is measured from there", async () => {
		// 80 days back to 2099 is far over the cap; 80 days back to now is not
		const fromDateTime = new Date(Date.now() - 80 * DAY_MS).toISOString();
		const before = Date.now();
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z`
		});
		const after = Date.now();

		assert.strictEqual(res.statusCode, 200);
		const filter = getTransactions.mock.calls[0]?.arguments.at(0) as
			| { fromDateTime: string; toDateTime: string }
			| undefined;
		assert.strictEqual(filter?.fromDateTime, fromDateTime);
		const toDateTime = Date.parse(filter?.toDateTime ?? "");
		assert.ok(toDateTime >= before && toDateTime <= after);
		assert.strictEqual(res.json().meta.toDateTime, filter?.toDateTime);
	});

	test("200: twelve calendar months across a leap day (366 days) are allowed", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:00.000Z`
		});
		assert.strictEqual(res.statusCode, 200);
	});

	test("200: detail maps the row to the wire shape, source as a typed union", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions/${TX_ID}`
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
			{ userId: USER_ID, transactionId: TX_ID }
		);
	});

	test("loan principal and interest carry the transaction's own currency", async () => {
		getTransactionDetail.mock.mockImplementationOnce(async () => ({
			...DETAIL,
			transactionType: "loan",
			currency: "USD",
			metadata: {
				operation: "repayment",
				loanAccountId: "5b2e1c3d-4a5f-4e6b-8c7d-9e0f1a2b3c4d",
				loanType: "home",
				principalAmount: 90000,
				interestAmount: 10000
			}
		}));

		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions/${TX_ID}`
		});
		assert.strictEqual(res.statusCode, 200);
		const fundingSource = res.json().fundingSource;
		assert.deepStrictEqual(fundingSource.principal, {
			amountMinor: 90000,
			currency: "USD"
		});
		assert.deepStrictEqual(fundingSource.interest, {
			amountMinor: 10000,
			currency: "USD"
		});
	});

	test("404: unknown transaction → not-found problem", async () => {
		// Runtime a missing row yields undefined; the mock's inferred type doesn't.
		getTransactionDetail.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof DETAIL
		);
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions/${TX_ID}`
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

		const self = new URL(body.links.self, "http://client.example");
		assert.strictEqual(
			self.searchParams.get("cursorOccurredAt"),
			"2026-09-01T00:00:00.000000Z"
		);
		assert.strictEqual(self.searchParams.get("cursorTransactionId"), TX_ID);

		const prev = new URL(body.links.prev, "http://client.example");
		assert.strictEqual(prev.searchParams.get("cursorDirection"), "prev");
		assert.strictEqual(
			prev.searchParams.get("cursorOccurredAt"),
			"2026-08-15T09:30:00.000123Z"
		);
		assert.strictEqual(prev.searchParams.get("cursorTransactionId"), TX_ID);
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
		assert.strictEqual("prev" in body.links, false);
		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.searchParams.get("cursorDirection"), "next");
		assert.strictEqual(
			next.searchParams.get("cursorOccurredAt"),
			"2026-08-14T12:00:00.000000Z"
		);
		assert.strictEqual(
			next.searchParams.get("cursorTransactionId"),
			"9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f"
		);
	});
});
