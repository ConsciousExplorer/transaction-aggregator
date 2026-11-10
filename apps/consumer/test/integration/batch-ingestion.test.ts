import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import type { Pool } from "pg";
import { compileRules, type RuleSet } from "#src/domain/rule-categoriser.ts";
import {
	buildCardRecord,
	buildDebitOrderRecord
} from "#src/domain/test-records.ts";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import { createDatabase } from "#src/integrations/database/pool.ts";
import { loadRuleset } from "#src/integrations/database/repositories/rule-repository.ts";
import {
	createTransactionBatchHandler,
	type DeadLetterFailure
} from "#src/integrations/events/handlers/transactionBatchHandler.ts";
import {
	insertTransactions,
	prepareTransaction
} from "#src/services/transaction-ingester.ts";
import {
	startTestDatabase,
	stopTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import { createRecordingDeadLetterSender } from "./helpers/dead-letters.ts";
import { buildValidMessage } from "./helpers/messages.ts";
import {
	CHECK_VIOLATION,
	readPostgresErrorCode
} from "./helpers/postgres-errors.ts";
import { CATEGORY_IDS, SEED_RULESET_VERSION } from "./helpers/rows.ts";

// The batch handler as app.ts builds it: the real ingester on kafka_consumer's
// pool and a ruleset loaded from the seeded database. Only the DLQ is a fake,
// one that records what it is given.

/** The category each of the user's rows was stored with, and the rule that chose it */
async function readStoredCategories(adminPool: Pool, userId: string) {
	const result = await adminPool.query(
		"SELECT external_id, category_id, rule_priority FROM txn_agg.transactions WHERE user_id = $1 ORDER BY external_id",
		[userId]
	);
	return result.rows;
}

async function readStoredExternalIds(adminPool: Pool, userId: string) {
	const result = await adminPool.query(
		"SELECT external_id FROM txn_agg.transactions WHERE user_id = $1 ORDER BY external_id",
		[userId]
	);
	const externalIds = [];
	for (const row of result.rows) {
		externalIds.push(row.external_id);
	}
	return externalIds;
}

suite("batch ingestion into Postgres", () => {
	let database: TestDatabase;
	let ruleset: RuleSet;

	before(
		async () => {
			database = await startTestDatabase();
			ruleset = await loadRuleset(
				createDatabase(database.consumerPool),
				SEED_RULESET_VERSION
			);
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		await stopTestDatabase(database);
	});

	test("a row Postgres rejects is dead-lettered alone, and the rest of the batch lands", async () => {
		const userId = randomUUID();
		const deadLetters: DeadLetterFailure[] = [];
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			ruleset,
			database.consumerPool,
			createRecordingDeadLetterSender(deadLetters)
		);
		// amount_minor > 0 is a CHECK in the DDL that the canonical schema does
		// not repeat, so the row passes normalisation and only Postgres says no
		const messages = [
			buildValidMessage(
				buildCardRecord({ transactionId: "kept-1", customerId: userId }),
				10n
			),
			buildValidMessage(
				buildCardRecord({
					transactionId: "rejected",
					customerId: userId,
					amount: 0
				}),
				11n
			),
			buildValidMessage(
				buildCardRecord({ transactionId: "kept-2", customerId: userId }),
				12n
			)
		];

		// Returning, rather than throwing, is what lets the adapter commit
		await handleTransactionBatch(messages);

		assert.deepStrictEqual(
			await readStoredExternalIds(database.adminPool, userId),
			["kept-1", "kept-2"]
		);
		assert.strictEqual(deadLetters.length, 1);
		const deadLetter = deadLetters[0];
		assert.ok(deadLetter);
		assert.strictEqual(deadLetter.message.offset, 11n);
		assert.deepStrictEqual(deadLetter.message.raw, messages[1]?.raw);
		assert.ok(deadLetter.error instanceof NonRetryableError);
		assert.strictEqual(
			readPostgresErrorCode(deadLetter.error),
			CHECK_VIOLATION
		);
	});

	// The seeded keyword rules match on the descriptions the debit-order
	// normaliser writes, so a repayment to a lender is loan_repayment rather
	// than the debit-order default, recurring_payments
	test("the seeded rules categorise a debit order to a lender by its keyword rule and any other by the default", async () => {
		const userId = randomUUID();
		const rules = compileRules(ruleset);

		await insertTransactions(
			[
				prepareTransaction(
					buildDebitOrderRecord({
						transactionId: "lender",
						customerId: userId,
						creditorName: "Wesbank",
						creditorAbbrevName: "Wesbank",
						description: "Debit order: Wesbank"
					}),
					"debit_order",
					rules
				),
				prepareTransaction(
					buildDebitOrderRecord({
						transactionId: "other",
						customerId: userId,
						creditorName: "Acme Storage",
						creditorAbbrevName: "Acme Storage",
						description: "Debit order: Acme Storage"
					}),
					"debit_order",
					rules
				)
			],
			database.consumerPool
		);

		assert.deepStrictEqual(
			await readStoredCategories(database.adminPool, userId),
			[
				{
					external_id: "lender",
					category_id: CATEGORY_IDS.loan_repayment,
					rule_priority: 351
				},
				{
					external_id: "other",
					category_id: CATEGORY_IDS.recurring_payments,
					rule_priority: 902
				}
			]
		);
	});

	// Version 2 maps the same card code to income, so which rules come back
	// shows which version was read.
	test("loads the configured ruleset version, not the newest one", async () => {
		await database.adminPool.query(
			"INSERT INTO txn_agg.rule_sets (version, notes) VALUES (2, 'test')"
		);
		await database.adminPool.query(
			`INSERT INTO txn_agg.categorization_rules
			   (ruleset_version, priority, matcher_type, pattern, category_id)
			 VALUES (2, 100, 'mcc', '5411', $1)`,
			[CATEGORY_IDS.income]
		);

		try {
			const consumerDatabase = createDatabase(database.consumerPool);
			const first = await loadRuleset(consumerDatabase, 1);
			const second = await loadRuleset(consumerDatabase, 2);

			assert.equal(first.version, 1);
			assert.equal(
				first.rules.find((rule) => rule.priority === 100)?.categoryId,
				CATEGORY_IDS.groceries
			);
			assert.equal(second.version, 2);
			assert.deepEqual(second.rules, [
				{
					priority: 100,
					matcherType: "mcc",
					pattern: "5411",
					categoryId: CATEGORY_IDS.income
				}
			]);
		} finally {
			await database.adminPool.query(
				"DELETE FROM txn_agg.categorization_rules WHERE ruleset_version = 2"
			);
			await database.adminPool.query(
				"DELETE FROM txn_agg.rule_sets WHERE version = 2"
			);
		}
	});

	test("an unknown ruleset version fails the load", async () => {
		await assert.rejects(
			loadRuleset(createDatabase(database.consumerPool), 99),
			/Ruleset version 99 not found/
		);
	});
});
