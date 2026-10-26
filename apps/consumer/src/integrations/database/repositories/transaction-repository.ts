import type { Pool } from "pg";
import type { CategorisedTransactionSchema } from "#src/schemas/transaction.ts";

/**
 * One statement for the whole batch, so it is atomic without a transaction.
 * UNNEST binds one array per column: 15 parameters however many rows.
 */
export async function batchInsertTransactions(
	pool: Pool,
	transactions: CategorisedTransactionSchema[]
) {
	if (transactions.length === 0) return { attempted: 0, inserted: 0 };

	// One array per column, each in transaction order, for UNNEST
	const userIds = [];
	const accountIds = [];
	const transactionTypes = [];
	const externalIds = [];
	const occurredAts = [];
	const creditDebitIndicators = [];
	const statuses = [];
	const amountMinors = [];
	const currencies = [];
	const longDescriptions = [];
	const shortDescriptions = [];
	const categoryIds = [];
	const ruleVersions = [];
	const rulePriorities = [];
	const metadataJson = [];
	for (const transaction of transactions) {
		userIds.push(transaction.userId);
		accountIds.push(transaction.accountId);
		transactionTypes.push(transaction.transactionType);
		externalIds.push(transaction.externalId);
		occurredAts.push(transaction.occurredAt);
		creditDebitIndicators.push(transaction.creditDebitIndicator);
		statuses.push(transaction.status);
		amountMinors.push(transaction.amountMinor);
		currencies.push(transaction.currency);
		longDescriptions.push(transaction.longDescription);
		shortDescriptions.push(transaction.shortDescription);
		categoryIds.push(transaction.categoryId);
		ruleVersions.push(transaction.ruleVersion);
		rulePriorities.push(transaction.rulePriority);
		metadataJson.push(JSON.stringify(transaction.metadata));
	}

	const result = await pool.query(
		`
        INSERT INTO txn_agg.transactions
        (
			user_id,
			account_id,
			transaction_type,
			external_id,
			occurred_at,
			credit_debit_indicator,
			status,
			amount_minor,
			currency,
			long_description,
			short_description,
			category_id,
        	rule_version,
			rule_priority,
			metadata
		)
        SELECT
			t.user_id,
			t.account_id,
			t.transaction_type,
			t.external_id,
			t.occurred_at,
			t.credit_debit_indicator,
			t.status,
			t.amount_minor,
			t.currency,
			t.long_description,
			t.short_description,
			t.category_id,
			t.rule_version,
			t.rule_priority,
			t.metadata
		FROM unnest(
        	$1::uuid[],
			$2::uuid[],
			$3::txn_agg.transaction_type[],
			$4::text[],
			$5::timestamptz[],
        	$6::txn_agg.credit_debit_indicator[],
			$7::txn_agg.transaction_status[],
			$8::bigint[],
			$9::text[],
			$10::text[],
			$11::text[],
			$12::bigint[],
			$13::bigint[],
			$14::bigint[],
        	$15::jsonb[])
		AS t (
			user_id,
			account_id,
			transaction_type,
			external_id,
			occurred_at,
			credit_debit_indicator,
			status,
			amount_minor,
			currency,
			long_description,
			short_description,
			category_id,
			rule_version,
			rule_priority,
			metadata
		)
        ON CONFLICT (transaction_type, external_id, occurred_at) DO NOTHING`,
		[
			userIds, // 1
			accountIds, // 2
			transactionTypes, // 3
			externalIds, // 4
			occurredAts, // 5
			creditDebitIndicators, // 6
			statuses, // 7
			amountMinors, // 8
			currencies, // 9
			longDescriptions, // 10
			shortDescriptions, // 11
			categoryIds, // 12
			ruleVersions, // 13
			rulePriorities, // 14
			metadataJson // 15 — string[] cast by $15::jsonb[]
		]
	);
	// An INSERT's row count leaves out the rows ON CONFLICT skipped
	return { attempted: transactions.length, inserted: result.rowCount ?? 0 };
}
