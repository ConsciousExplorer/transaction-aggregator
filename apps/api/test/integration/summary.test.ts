import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildTestSigningKeys, signTestToken } from "#src/auth/test-tokens.ts";
import {
	EXPECTED_BY_CATEGORY,
	EXPECTED_BY_CATEGORY_WITH_OVERRIDES,
	EXPECTED_BY_MONTH,
	EXPECTED_TOTALS,
	type ExpectedGroup,
	SAMPLE_ROWS,
	SAMPLE_USER_ID,
	SAMPLE_WINDOW
} from "../fixtures/sample-records.ts";
import {
	startTestDatabase,
	stopTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import { CATEGORY_IDS, insertTransactions } from "./helpers/seed.ts";
import { buildTestServer, readAs, sendAs } from "./helpers/server.ts";

const SUMMARY_URL = `/api/v1/users/${SAMPLE_USER_ID}/summary?${SAMPLE_WINDOW}`;

function buildAmount(amountMinor: number) {
	return { amountMinor, currency: "ZAR" };
}

/** An expected group in the form the summary returns it */
function buildExpectedItem(expected: ExpectedGroup) {
	const group =
		expected.month === undefined
			? { category: expected.category }
			: { category: expected.category, month: expected.month };
	return {
		group,
		count: expected.count,
		netAmount: buildAmount(expected.net),
		debit: {
			count: expected.debitCount,
			total: buildAmount(expected.debitTotal)
		},
		credit: {
			count: expected.creditCount,
			total: buildAmount(expected.creditTotal)
		}
	};
}

function buildExpectedItems(expectedGroups: ExpectedGroup[]) {
	const items = [];
	for (const expected of expectedGroups) {
		items.push(buildExpectedItem(expected));
	}
	return items;
}

const EXPECTED_TOTALS_RESPONSE = {
	transactionCount: EXPECTED_TOTALS.transactionCount,
	netAmount: buildAmount(EXPECTED_TOTALS.net),
	debit: {
		count: EXPECTED_TOTALS.debitCount,
		total: buildAmount(EXPECTED_TOTALS.debitTotal)
	},
	credit: {
		count: EXPECTED_TOTALS.creditCount,
		total: buildAmount(EXPECTED_TOTALS.creditTotal)
	}
};

suite("summary against the hand-computed samples", () => {
	let database: TestDatabase;
	let server: FastifyInstance;
	let writeToken: string;
	let sampleTransactionIds: string[];

	before(
		async () => {
			database = await startTestDatabase();
			const { privateKey, tokenVerification } = await buildTestSigningKeys();
			writeToken = await signTestToken(privateKey, {
				sub: randomUUID(),
				azp: "banking-portal",
				scope: "tx:read tx:write"
			});
			server = await buildTestServer(database, tokenVerification);

			const inserted = await insertTransactions(database.adminDb, SAMPLE_ROWS);
			sampleTransactionIds = [];
			for (const row of inserted) {
				sampleTransactionIds.push(row.transactionId);
			}
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		await server.close();
		await stopTestDatabase(database);
	});

	test("by category, over the whole window", async () => {
		const response = await readAs(server, writeToken, SUMMARY_URL);

		assert.strictEqual(response.statusCode, 200, response.body);
		assert.deepStrictEqual(
			response.json().data,
			buildExpectedItems(EXPECTED_BY_CATEGORY)
		);
		assert.deepStrictEqual(response.json().totals, EXPECTED_TOTALS_RESPONSE);
	});

	test("by month, rows on either side of the month boundary in their own month", async () => {
		const response = await readAs(
			server,
			writeToken,
			`${SUMMARY_URL}&interval=month`
		);

		assert.strictEqual(response.statusCode, 200, response.body);
		assert.deepStrictEqual(
			response.json().data,
			buildExpectedItems(EXPECTED_BY_MONTH)
		);
		assert.deepStrictEqual(response.json().totals, EXPECTED_TOTALS_RESPONSE);
	});

	test("a transaction override beats a remap, and deleting both restores the system categories", async () => {
		const remap = await sendAs(
			server,
			writeToken,
			"PUT",
			`/api/v1/users/${SAMPLE_USER_ID}/category-overrides/${CATEGORY_IDS.transport}`,
			{ toCategoryId: CATEGORY_IDS.retail }
		);
		assert.strictEqual(remap.statusCode, 200, remap.body);
		// Row 4 is transport, so the remap covers it too: the override must win
		const override = await sendAs(
			server,
			writeToken,
			"PUT",
			`/api/v1/users/${SAMPLE_USER_ID}/transaction-overrides/${sampleTransactionIds[4]}`,
			{ categoryId: CATEGORY_IDS.dining }
		);
		assert.strictEqual(override.statusCode, 200, override.body);

		const withOverrides = await readAs(server, writeToken, SUMMARY_URL);
		assert.deepStrictEqual(
			withOverrides.json().data,
			buildExpectedItems(EXPECTED_BY_CATEGORY_WITH_OVERRIDES)
		);
		assert.deepStrictEqual(
			withOverrides.json().totals,
			EXPECTED_TOTALS_RESPONSE
		);

		await sendAs(
			server,
			writeToken,
			"DELETE",
			`/api/v1/users/${SAMPLE_USER_ID}/category-overrides/${CATEGORY_IDS.transport}`
		);
		await sendAs(
			server,
			writeToken,
			"DELETE",
			`/api/v1/users/${SAMPLE_USER_ID}/transaction-overrides/${sampleTransactionIds[4]}`
		);

		// Every sample row happened months before its insert, so this also
		// checks the archive finds an override without the id's time
		const reverted = await readAs(server, writeToken, SUMMARY_URL);
		assert.deepStrictEqual(
			reverted.json().data,
			buildExpectedItems(EXPECTED_BY_CATEGORY)
		);
	});
});
