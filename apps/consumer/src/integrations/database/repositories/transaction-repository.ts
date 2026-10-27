import type { Pool } from "pg";
import type { CategorisedTransactionSchema } from "#src/schemas/transaction.ts";

/**
 * One statement for the whole batch, so it is atomic without a transaction.
 * The batch goes over as one JSON array of rows, keyed by column name, and
 * json_populate_recordset turns it back into rows of the table's own type:
 * one parameter however many rows, and Postgres converts each value to its
 * column's type.
 */
export async function batchInsertTransactions(
	pool: Pool,
	transactions: CategorisedTransactionSchema[]
) {
	const rows = [];
	for (const transaction of transactions) {
		rows.push({
			user_id: transaction.userId,
			account_id: transaction.accountId,
			transaction_type: transaction.transactionType,
			external_id: transaction.externalId,
			occurred_at: transaction.occurredAt,
			credit_debit_indicator: transaction.creditDebitIndicator,
			status: transaction.status,
			amount_minor: transaction.amountMinor,
			currency: transaction.currency,
			long_description: transaction.longDescription,
			short_description: transaction.shortDescription,
			category_id: transaction.categoryId,
			rule_version: transaction.ruleVersion,
			rule_priority: transaction.rulePriority,
			metadata: transaction.metadata
		});
	}

	// The column list is written twice because the record set also has the
	// columns the table fills itself (transaction_id, ingested_at), which must
	// be left to their defaults rather than inserted as null.
	const result = await pool.query(
		`
		INSERT INTO txn_agg.transactions (
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
		FROM json_populate_recordset(NULL::txn_agg.transactions, $1::json)
		ON CONFLICT (transaction_type, external_id, occurred_at) DO NOTHING`,
		[JSON.stringify(rows)]
	);
	// An INSERT's row count leaves out the rows ON CONFLICT skipped
	return { attempted: transactions.length, inserted: result.rowCount ?? 0 };
}
