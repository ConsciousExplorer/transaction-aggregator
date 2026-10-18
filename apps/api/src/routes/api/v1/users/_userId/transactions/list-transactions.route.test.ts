import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import registerListTransactionsRoute from "./list-transactions.route.ts";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const TRANSACTION_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const OLDER_TRANSACTION_ID = "9d4b2f7c-0a3e-4c8d-b5f1-2e6a7c8d9e0f";
const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";
// links.self is the request with the window as read; ":" stays unencoded
const LIST_URL = `/api/v1/users/${USER_ID}/transactions?fromDateTime=${FROM}&toDateTime=${TO}`;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// A cursor travels as base64url JSON. These build and read it with Buffer and
// JSON directly, so the tests pin the wire format, not the route's own helpers.
function encodeTestCursor(payload: unknown) {
	return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function readLinkCursor(link: string): unknown {
	const cursor = new URL(link, "http://client.example").searchParams.get(
		"cursor"
	);
	assert.ok(cursor, `no cursor in ${link}`);
	return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

// Typed off the real method so drift in the select shape breaks compilation
const ROWS: Awaited<ReturnType<UserTransactionRepository["getTransactions"]>> =
	[
		{
			transactionId: TRANSACTION_ID,
			occurredAt: "2026-08-15T09:30:00.000Z",
			transactionType: "card",
			creditDebitIndicator: "debit",
			status: "completed",
			amountMinor: 1234,
			currency: "ZAR",
			category: "groceries",
			shortDescription: "Spar",
			cursorOccurredAt: "2026-08-15T09:30:00.000123Z"
		},
		{
			transactionId: OLDER_TRANSACTION_ID,
			occurredAt: "2026-08-14T12:00:00.000Z",
			transactionType: "eft",
			creditDebitIndicator: "credit",
			status: "reversed",
			amountMinor: 50000,
			currency: "ZAR",
			category: "salary",
			shortDescription: null,
			cursorOccurredAt: "2026-08-14T12:00:00.000000Z"
		}
	];

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `db` is here only to satisfy the
// class shape; the route goes through the methods.
const getTransactions = mock.fn<UserTransactionRepository["getTransactions"]>(
	async () => ROWS
);
const transactionRepository = {
	db: {} as NodePgDatabase,
	getTransactions,
	getTransactionDetail: mock.fn(async () => undefined),
	setTransactionCategory: mock.fn(async () => undefined),
	archiveTransactionCategory: mock.fn(async () => undefined)
} satisfies UserTransactionRepository;

function readRepositoryFilter() {
	return getTransactions.mock.calls[0]?.arguments.at(0);
}

suite("GET /api/v1/users/:userId/transactions", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerListTransactionsRoute, {
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
	});

	test("200: list maps rows to the wire shape, non-completed statuses included", async () => {
		const response = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			data: [
				{
					transactionId: TRANSACTION_ID,
					occurredAt: "2026-08-15T09:30:00.000Z",
					transactionType: "card",
					creditDebitIndicator: "debit",
					status: "completed",
					amount: { amountMinor: 1234, currency: "ZAR" },
					category: "groceries",
					shortDescription: "Spar"
				},
				{
					transactionId: OLDER_TRANSACTION_ID,
					occurredAt: "2026-08-14T12:00:00.000Z",
					transactionType: "eft",
					creditDebitIndicator: "credit",
					status: "reversed",
					amount: { amountMinor: 50000, currency: "ZAR" },
					category: "salary",
					shortDescription: null
				}
			],
			links: { self: LIST_URL },
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
		assert.deepStrictEqual(readRepositoryFilter(), {
			userId: USER_ID,
			fromDateTime: FROM,
			toDateTime: TO,
			accountId: undefined,
			transactionType: "card",
			category: "groceries",
			creditDebitIndicator: undefined,
			amountMin: undefined,
			amountMax: undefined,
			sort: "-occurredAt",
			cursor: undefined,
			limit: 51
		});
	});

	test("accountId narrows the list to those accounts, one or many", async () => {
		await app.inject({
			method: "GET",
			url: `${LIST_URL}&accountId=5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a&accountId=6f3a9b21-5c4d-4e2f-8a7b-8c9d0e1f2a3b`
		});
		assert.deepStrictEqual(readRepositoryFilter()?.accountId, [
			"5e2f8a10-4b3c-4d1e-9f6a-7b8c9d0e1f2a",
			"6f3a9b21-5c4d-4e2f-8a7b-8c9d0e1f2a3b"
		]);
	});

	test("400: an accountId that isn't a UUID → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&accountId=not-a-uuid`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("sort=occurredAt reaches the repository and every link keeps it", async () => {
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&sort=occurredAt&limit=1`
		});
		assert.strictEqual(response.statusCode, 200);
		assert.strictEqual(readRepositoryFilter()?.sort, "occurredAt");

		const body = response.json();
		assert.strictEqual(body.meta.sort, "occurredAt");
		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.searchParams.get("sort"), "occurredAt");
	});

	test("200: a full page returns limit rows and a cursor from the last one", async () => {
		// limit=1 and the repository returns 2 rows: the look-ahead row proves
		// another page exists and is not returned.
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&limit=1`
		});
		assert.strictEqual(response.statusCode, 200);

		const body = response.json();
		assert.strictEqual(body.data.length, 1);
		assert.strictEqual(body.data[0].transactionId, TRANSACTION_ID);
		assert.strictEqual(body.meta.count, 1);
		assert.strictEqual(body.meta.limit, 1);

		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.pathname, `/api/v1/users/${USER_ID}/transactions`);
		assert.strictEqual(next.searchParams.get("fromDateTime"), FROM);
		assert.strictEqual(next.searchParams.get("toDateTime"), TO);
		assert.strictEqual(next.searchParams.get("limit"), "1");
		assert.deepStrictEqual(readLinkCursor(body.links.next), {
			direction: "next",
			position: {
				occurredAt: "2026-08-15T09:30:00.000123Z",
				transactionId: TRANSACTION_ID
			}
		});
	});

	test("the next link keeps every filter as sent and replaces the previous cursor", async () => {
		const sent = encodeTestCursor({
			direction: "next",
			position: {
				occurredAt: "2026-09-01T00:00:00.000000Z",
				transactionId: OLDER_TRANSACTION_ID
			}
		});
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&transactionType=card&transactionType=eft&limit=1&cursor=${sent}`
		});
		assert.strictEqual(response.statusCode, 200);

		const body = response.json();
		const next = new URL(body.links.next, "http://client.example");
		assert.deepStrictEqual(next.searchParams.getAll("transactionType"), [
			"card",
			"eft"
		]);
		assert.strictEqual(next.searchParams.getAll("cursor").length, 1);
		assert.deepStrictEqual(readLinkCursor(body.links.next), {
			direction: "next",
			position: {
				occurredAt: "2026-08-15T09:30:00.000123Z",
				transactionId: TRANSACTION_ID
			}
		});
	});

	test("the cursor from links.next reaches the repository as the keyset alone", async () => {
		const position = {
			occurredAt: "2026-08-15T09:30:00.000123Z",
			transactionId: TRANSACTION_ID
		};
		await app.inject({
			method: "GET",
			url: `${LIST_URL}&cursor=${encodeTestCursor({ direction: "next", position })}`
		});
		assert.deepStrictEqual(readRepositoryFilter()?.cursor, position);
		assert.strictEqual(readRepositoryFilter()?.sort, "-occurredAt");
	});

	const INVALID_CURSORS = [
		["text that isn't base64url JSON", "not-a-cursor"],
		[
			"an unknown direction",
			encodeTestCursor({
				direction: "sideways",
				position: {
					occurredAt: "2026-08-15T09:30:00.000123Z",
					transactionId: TRANSACTION_ID
				}
			})
		],
		[
			"an occurredAt that isn't a datetime",
			encodeTestCursor({
				direction: "next",
				position: { occurredAt: "yesterday", transactionId: TRANSACTION_ID }
			})
		],
		[
			"a millisecond occurredAt",
			encodeTestCursor({
				direction: "next",
				position: {
					occurredAt: "2026-08-15T09:30:00.000Z",
					transactionId: TRANSACTION_ID
				}
			})
		],
		[
			"a cursor without a position",
			encodeTestCursor({
				occurredAt: "2026-08-15T09:30:00.000123Z",
				transactionId: TRANSACTION_ID,
				direction: "next"
			})
		]
	];
	for (const [name, cursor] of INVALID_CURSORS) {
		test(`400 invalid-cursor: ${name}, repository untouched`, async () => {
			const response = await app.inject({
				method: "GET",
				url: `${LIST_URL}&cursor=${cursor}`
			});
			assert.strictEqual(response.statusCode, 400);
			assert.deepStrictEqual(response.json(), {
				type: "invalid-cursor",
				title: "Malformed pagination cursor",
				status: 400
			});
			assert.strictEqual(getTransactions.mock.callCount(), 0);
		});
	}

	test("400: a userId that isn't a UUID → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/not-a-uuid/transactions?fromDateTime=${FROM}&toDateTime=${TO}`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("self, next and prev all carry the window as read, a future toDateTime as now", async () => {
		const fromDateTime = new Date(
			Date.now() - 80 * MILLISECONDS_PER_DAY
		).toISOString();
		const sent = encodeTestCursor({
			direction: "next",
			position: {
				occurredAt: "2026-09-01T00:00:00.000000Z",
				transactionId: TRANSACTION_ID
			}
		});
		// A cursor page that comes back full has both neighbours
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z&limit=1&cursor=${sent}`
		});
		assert.strictEqual(response.statusCode, 200);

		const body = response.json();
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
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:01.000Z`
		});
		assert.strictEqual(response.statusCode, 400);
		assert.deepStrictEqual(response.json(), {
			type: "window-too-large",
			title: "Time window too large",
			status: 400,
			detail: "fromDateTime to toDateTime may span at most 366 days"
		});
		assert.strictEqual(getTransactions.mock.callCount(), 0);
	});

	test("a future toDateTime is read as now, and the window is measured from there", async () => {
		// 80 days back to 2099 is far over the cap; 80 days back to now is not
		const fromDateTime = new Date(
			Date.now() - 80 * MILLISECONDS_PER_DAY
		).toISOString();
		const startedAt = Date.now();
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=${fromDateTime}&toDateTime=2099-01-01T00:00:00.000Z`
		});
		const finishedAt = Date.now();

		assert.strictEqual(response.statusCode, 200);
		const filter = readRepositoryFilter();
		assert.strictEqual(filter?.fromDateTime, fromDateTime);
		const toDateTime = Date.parse(filter?.toDateTime ?? "");
		assert.ok(toDateTime >= startedAt && toDateTime <= finishedAt);
		assert.strictEqual(response.json().meta.toDateTime, filter?.toDateTime);
	});

	test("200: twelve calendar months across a leap day (366 days) are allowed", async () => {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/transactions?fromDateTime=2023-03-01T00:00:00.000Z&toDateTime=2024-03-01T00:00:00.000Z`
		});
		assert.strictEqual(response.statusCode, 200);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getTransactions.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({ method: "GET", url: LIST_URL });
		assert.strictEqual(response.statusCode, 500);
		assert.ok(
			String(response.headers["content-type"]).startsWith(
				"application/problem+json"
			)
		);
		assert.strictEqual(response.json().type, "internal");
		assert.ok(!response.body.includes("hunter2"));
	});

	test("a page reached through next links back with prev from its first row", async () => {
		const sent = encodeTestCursor({
			direction: "next",
			position: {
				occurredAt: "2026-09-01T00:00:00.000000Z",
				transactionId: TRANSACTION_ID
			}
		});
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&limit=1&cursor=${sent}`
		});
		const body = response.json();

		const self = new URL(body.links.self, "http://client.example");
		assert.strictEqual(self.searchParams.get("cursor"), sent);

		assert.deepStrictEqual(readLinkCursor(body.links.prev), {
			direction: "prev",
			position: {
				occurredAt: "2026-08-15T09:30:00.000123Z",
				transactionId: TRANSACTION_ID
			}
		});
	});

	test("a prev page is read upwards and served newest first", async () => {
		// Upwards from the cursor the repository returns oldest first
		getTransactions.mock.mockImplementationOnce(async () =>
			[...ROWS].reverse()
		);

		const sent = encodeTestCursor({
			direction: "prev",
			position: {
				occurredAt: "2026-08-01T00:00:00.000000Z",
				transactionId: TRANSACTION_ID
			}
		});
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&cursor=${sent}`
		});
		const body = response.json();

		assert.strictEqual(readRepositoryFilter()?.sort, "occurredAt");
		assert.strictEqual(body.meta.sort, "-occurredAt");
		const transactionIds = [];
		for (const row of body.data as { transactionId: string }[]) {
			transactionIds.push(row.transactionId);
		}
		assert.deepStrictEqual(
			transactionIds,
			[TRANSACTION_ID, OLDER_TRANSACTION_ID],
			"newest first, like every other page"
		);
		// Not full, so nothing newer; came from an older page, so next exists
		assert.strictEqual("prev" in body.links, false);
		assert.deepStrictEqual(readLinkCursor(body.links.next), {
			direction: "next",
			position: {
				occurredAt: "2026-08-14T12:00:00.000000Z",
				transactionId: OLDER_TRANSACTION_ID
			}
		});
	});

	test("an oldest-first prev page is read newest first, and the links keep the sort", async () => {
		const sent = encodeTestCursor({
			direction: "prev",
			position: {
				occurredAt: "2026-08-20T00:00:00.000000Z",
				transactionId: TRANSACTION_ID
			}
		});
		const response = await app.inject({
			method: "GET",
			url: `${LIST_URL}&sort=occurredAt&cursor=${sent}`
		});
		const body = response.json();

		assert.strictEqual(readRepositoryFilter()?.sort, "-occurredAt");
		assert.strictEqual(body.meta.sort, "occurredAt");
		const next = new URL(body.links.next, "http://client.example");
		assert.strictEqual(next.searchParams.get("sort"), "occurredAt");
	});
});
