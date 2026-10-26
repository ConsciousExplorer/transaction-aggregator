import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildTestSigningKeys, signTestToken } from "#src/auth/test-tokens.ts";
import {
	startTestDatabase,
	stopTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import { CATEGORY_IDS, insertTransactions } from "./helpers/seed.ts";
import { buildTestServer, readAs } from "./helpers/server.ts";

const AUGUST =
	"fromDateTime=2026-08-01T00:00:00Z&toDateTime=2026-09-01T00:00:00Z";

/**
 * Follows links[direction] from firstUrl until a page has none. Returns the
 * transaction ids on each page, and the last page's url to walk back from.
 */
async function walkPages(
	server: FastifyInstance,
	token: string,
	firstUrl: string,
	direction: "next" | "prev"
) {
	const pages: string[][] = [];
	let lastUrl = firstUrl;
	let url: string | undefined = firstUrl;
	while (url !== undefined) {
		const response = await readAs(server, token, url);
		assert.strictEqual(response.statusCode, 200, response.body);
		const body = response.json();

		const ids: string[] = [];
		for (const item of body.data) {
			ids.push(item.transactionId);
		}
		pages.push(ids);
		lastUrl = url;
		url = body.links[direction];
	}
	return { pages, lastUrl };
}

suite("transactions, read through the API", () => {
	let database: TestDatabase;
	let server: FastifyInstance;
	let readToken: string;

	before(
		async () => {
			database = await startTestDatabase();
			const { privateKey, tokenVerification } = await buildTestSigningKeys();
			readToken = await signTestToken(privateKey, {
				sub: randomUUID(),
				azp: "banking-service",
				scope: "tx:read"
			});
			server = await buildTestServer(database, tokenVerification);
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		await server.close();
		await stopTestDatabase(database);
	});

	test("detail finds a transaction that happened long before it was inserted", async () => {
		// The id's time is the insert, months after occurred_at, so the lookup
		// can't take its partition from the id
		const userId = randomUUID();
		const [inserted] = await insertTransactions(database.adminDatabase, [
			{
				userId,
				occurredAt: "2026-01-15T10:00:00.000Z",
				creditDebitIndicator: "debit",
				amountMinor: 2500,
				categoryId: CATEGORY_IDS.groceries
			}
		]);
		assert.ok(inserted);

		const response = await readAs(
			server,
			readToken,
			`/api/v1/users/${userId}/transactions/${inserted.transactionId}`
		);

		assert.strictEqual(response.statusCode, 200, response.body);
		assert.strictEqual(response.json().transactionId, inserted.transactionId);
		assert.strictEqual(response.json().occurredAt, "2026-01-15T10:00:00.000Z");
	});

	test("detail of another user's transaction is the same 404 as one that doesn't exist", async () => {
		const [othersTransaction] = await insertTransactions(
			database.adminDatabase,
			[
				{
					userId: randomUUID(),
					occurredAt: "2026-08-15T10:00:00.000Z",
					creditDebitIndicator: "debit",
					amountMinor: 2500,
					categoryId: CATEGORY_IDS.groceries
				}
			]
		);
		assert.ok(othersTransaction);
		const userId = randomUUID();

		const othersResponse = await readAs(
			server,
			readToken,
			`/api/v1/users/${userId}/transactions/${othersTransaction.transactionId}`
		);
		const missingResponse = await readAs(
			server,
			readToken,
			`/api/v1/users/${userId}/transactions/${randomUUID()}`
		);

		assert.strictEqual(othersResponse.statusCode, 404);
		assert.strictEqual(othersResponse.json().type, "not-found");
		assert.deepStrictEqual(othersResponse.json(), missingResponse.json());
	});

	test("a walk returns every row once, rows 1 µs apart included, and walks back over the same pages", async () => {
		const userId = randomUUID();
		const fixtures = [
			{ occurredAt: "2026-08-15T10:00:00.000001Z" },
			{ occurredAt: "2026-08-15T10:00:00.000002Z" },
			// Two rows at the same instant: the id breaks the tie
			{
				occurredAt: "2026-08-15T10:00:00.000003Z",
				transactionId: "00000000-0000-7000-8000-000000000001"
			},
			{
				occurredAt: "2026-08-15T10:00:00.000003Z",
				transactionId: "00000000-0000-7000-8000-000000000002"
			},
			{ occurredAt: "2026-08-15T10:00:00.000004Z" }
		];
		const rows = [];
		for (const fixture of fixtures) {
			rows.push({
				userId,
				creditDebitIndicator: "debit" as const,
				amountMinor: 100,
				categoryId: CATEGORY_IDS.groceries,
				...fixture
			});
		}
		const inserted = await insertTransactions(database.adminDatabase, rows);
		const ids: string[] = [];
		for (const row of inserted) {
			ids.push(row.transactionId);
		}

		const forward = await walkPages(
			server,
			readToken,
			`/api/v1/users/${userId}/transactions?${AUGUST}&limit=2`,
			"next"
		);

		// Newest first
		assert.deepStrictEqual(forward.pages, [
			[ids[4], ids[3]],
			[ids[2], ids[1]],
			[ids[0]]
		]);

		// From the last page back to the first
		const backward = await walkPages(
			server,
			readToken,
			forward.lastUrl,
			"prev"
		);

		assert.deepStrictEqual(backward.pages, [
			[ids[0]],
			[ids[2], ids[1]],
			[ids[4], ids[3]]
		]);
	});

	test("the window includes fromDateTime and excludes toDateTime", async () => {
		const userId = randomUUID();
		const inserted = await insertTransactions(database.adminDatabase, [
			{
				userId,
				occurredAt: "2026-07-31T23:59:59.999999Z",
				creditDebitIndicator: "debit",
				amountMinor: 100,
				categoryId: CATEGORY_IDS.groceries
			},
			{
				userId,
				occurredAt: "2026-08-01T00:00:00.000000Z",
				creditDebitIndicator: "debit",
				amountMinor: 100,
				categoryId: CATEGORY_IDS.groceries
			},
			{
				userId,
				occurredAt: "2026-09-01T00:00:00.000000Z",
				creditDebitIndicator: "debit",
				amountMinor: 100,
				categoryId: CATEGORY_IDS.groceries
			}
		]);

		const response = await readAs(
			server,
			readToken,
			`/api/v1/users/${userId}/transactions?${AUGUST}`
		);

		const ids = [];
		for (const item of response.json().data) {
			ids.push(item.transactionId);
		}
		assert.deepStrictEqual(ids, [inserted[1]?.transactionId]);
	});

	// Checked against the categories table: a typo would otherwise match
	// nothing and read as no spending
	test("a category slug no category has is a 400 that names it", async () => {
		const response = await readAs(
			server,
			readToken,
			`/api/v1/users/${randomUUID()}/transactions?${AUGUST}&category=groceries&category=grocery`
		);

		assert.strictEqual(response.statusCode, 400, response.body);
		assert.deepStrictEqual(response.json().errors, [
			{ path: ["category"], message: "unknown category grocery" }
		]);
	});

	test("each filter narrows the list to the rows it names", async () => {
		const userId = randomUUID();
		const accountId = randomUUID();
		const inserted = await insertTransactions(database.adminDatabase, [
			{
				userId,
				accountId,
				occurredAt: "2026-08-10T10:00:00.000Z",
				creditDebitIndicator: "debit",
				amountMinor: 1000,
				categoryId: CATEGORY_IDS.groceries
			},
			{
				userId,
				occurredAt: "2026-08-11T10:00:00.000Z",
				creditDebitIndicator: "credit",
				amountMinor: 5000,
				categoryId: CATEGORY_IDS.income
			},
			{
				userId,
				occurredAt: "2026-08-12T10:00:00.000Z",
				creditDebitIndicator: "debit",
				amountMinor: 20000,
				categoryId: CATEGORY_IDS.dining,
				status: "pending"
			}
		]);
		const [groceries, income, dining] = inserted;
		assert.ok(groceries && income && dining);

		const cases = [
			{ query: `accountId=${accountId}`, expected: [groceries] },
			{ query: "creditDebitIndicator=credit", expected: [income] },
			{ query: "category=dining", expected: [dining] },
			{ query: "amountMin=2000&amountMax=6000", expected: [income] },
			// Every status is listed; only the summary counts completed rows alone
			{ query: "", expected: [dining, income, groceries] }
		];

		for (const testCase of cases) {
			const response = await readAs(
				server,
				readToken,
				`/api/v1/users/${userId}/transactions?${AUGUST}&${testCase.query}`
			);
			assert.strictEqual(response.statusCode, 200, response.body);

			const ids = [];
			for (const item of response.json().data) {
				ids.push(item.transactionId);
			}
			const expectedIds = [];
			for (const row of testCase.expected) {
				expectedIds.push(row.transactionId);
			}
			assert.deepStrictEqual(ids, expectedIds, testCase.query);
		}
	});
});
