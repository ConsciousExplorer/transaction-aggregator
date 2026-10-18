import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import type { Pool } from "pg";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import type { CategorisedTransactionSchema } from "#src/schemas/transaction.ts";
import {
	startTestDatabase,
	stopTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import { buildCategorisedRow, CATEGORY_IDS } from "./helpers/rows.ts";

// The consumer's batch insert, run as kafka_consumer and read back as admin.
// It binds one array per column by position and lets Postgres zip them, skip
// duplicates and choose the partition, so only Postgres can show the result.

/** Every column the insert writes, for one user, ordered by external id */
async function readStoredRows(adminPool: Pool, userId: string) {
	const result = await adminPool.query(
		`SELECT user_id, account_id, transaction_type, external_id, occurred_at,
		        credit_debit_indicator, status, amount_minor, currency,
		        long_description, short_description, category_id, rule_version,
		        rule_priority, metadata
		 FROM txn_agg.transactions
		 WHERE user_id = $1
		 ORDER BY external_id`,
		[userId]
	);
	return result.rows;
}

/**
 * What readStoredRows returns for a row. node-postgres reads a bigint as a
 * string and a timestamptz as a Date, and jsonb comes back parsed.
 */
function buildExpectedRow(row: CategorisedTransactionSchema) {
	return {
		user_id: row.userId,
		account_id: row.accountId,
		transaction_type: row.transactionType,
		external_id: row.externalId,
		occurred_at: new Date(row.occurredAt),
		credit_debit_indicator: row.creditDebitIndicator,
		status: row.status,
		amount_minor: String(row.amountMinor),
		currency: row.currency,
		long_description: row.longDescription,
		short_description: row.shortDescription,
		category_id: row.categoryId,
		rule_version: row.ruleVersion,
		rule_priority: row.rulePriority,
		metadata: row.metadata
	};
}

async function countStoredRows(adminPool: Pool, userId: string) {
	const result = await adminPool.query(
		"SELECT count(*)::int AS count FROM txn_agg.transactions WHERE user_id = $1",
		[userId]
	);
	return result.rows[0]?.count;
}

/** The partition each of the user's rows was stored in */
async function readPartitionNames(adminPool: Pool, userId: string) {
	const result = await adminPool.query(
		"SELECT tableoid::regclass::text AS partition FROM txn_agg.transactions WHERE user_id = $1",
		[userId]
	);
	const partitions = [];
	for (const row of result.rows) {
		partitions.push(row.partition);
	}
	return partitions;
}

suite("the consumer's batch insert", () => {
	let database: TestDatabase;

	before(
		async () => {
			database = await startTestDatabase();
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		await stopTestDatabase(database);
	});

	test("every field of a batch lands in its own column", async () => {
		const userId = randomUUID();
		// Every column holds a value no other column holds, so a swapped pair
		// of same-typed arrays shows up as a wrong value
		const full = buildCategorisedRow({
			userId,
			externalId: "full",
			transactionType: "eft",
			creditDebitIndicator: "credit",
			status: "pending",
			// Past the 32-bit range, so the bigint path is the one tested
			amountMinor: 123_456_789_012,
			longDescription: "long description",
			shortDescription: "short description",
			// node-postgres sends the array as a Postgres array literal, so these
			// strings are escaped twice on the way in
			metadata: {
				reference: 'a "quoted" \\ backslash and non-ASCII é ü ✓',
				nested: { list: [1, "two", null] }
			},
			categoryId: CATEGORY_IDS.income,
			rulePriority: 700
		});
		const sparse = buildCategorisedRow({
			userId,
			externalId: "sparse",
			transactionType: "loan",
			longDescription: null,
			shortDescription: null,
			metadata: {},
			categoryId: CATEGORY_IDS.uncategorised,
			// The engine's fallback: no rule matched
			rulePriority: null
		});

		const outcome = await batchInsertTransactions(database.consumerPool, [
			full,
			sparse
		]);

		assert.deepStrictEqual(outcome, { attempted: 2, inserted: 2 });
		assert.deepStrictEqual(await readStoredRows(database.adminPool, userId), [
			buildExpectedRow(full),
			buildExpectedRow(sparse)
		]);
	});

	test("a re-sent batch inserts only what is new, and its count says how many", async () => {
		const userId = randomUUID();
		const first = buildCategorisedRow({ userId, externalId: "first" });
		const second = buildCategorisedRow({ userId, externalId: "second" });
		const third = buildCategorisedRow({ userId, externalId: "third" });

		await batchInsertTransactions(database.consumerPool, [first, second]);
		// Both again, one new record, and that record twice in the same batch
		const resend = await batchInsertTransactions(database.consumerPool, [
			first,
			second,
			third,
			third
		]);

		assert.deepStrictEqual(resend, { attempted: 4, inserted: 1 });
		assert.strictEqual(await countStoredRows(database.adminPool, userId), 3);
	});

	test("a transaction older than every monthly partition is kept in the default partition", async () => {
		const userId = randomUUID();
		// Older than the oldest partition the migration creates (now − 19 months)
		const late = buildCategorisedRow({
			userId,
			occurredAt: "2023-01-15T10:00:00.000Z"
		});

		const outcome = await batchInsertTransactions(database.consumerPool, [
			late
		]);

		assert.deepStrictEqual(outcome, { attempted: 1, inserted: 1 });
		assert.deepStrictEqual(
			await readPartitionNames(database.adminPool, userId),
			["txn_agg.transactions_default"]
		);
	});
});
