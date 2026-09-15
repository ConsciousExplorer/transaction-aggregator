import type z from "zod";
import type { categorisedTransactionSchema } from "#src/domain/transaction.ts";
import type { Queryable } from "../pool.ts";

export async function batchInsertTransactions(
	db: Queryable,
	transactions: z.infer<typeof categorisedTransactionSchema>[]
): Promise<{ attempted: number; inserted: number }> {
	if (transactions.length === 0) return { attempted: 0, inserted: 0 };

	const result = await db.query(
		`
        INSERT INTO transactions
        (
			user_id,
			account_id,
			transaction_type,
			external_id,
			occurred_at,
			direction,
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
			t.direction,
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
			$3::transaction_type[],
			$4::text[],
			$5::timestamptz[],
        	$6::direction_type[],
			$7::bigint[],
			$8::text[],
			$9::text[],
			$10::text[],
			$11::bigint[],
			$12::bigint[],
			$13::bigint[],
        	$14::jsonb[])
		AS t (
			user_id,
			account_id,
			transaction_type,
			external_id,
			occurred_at,
			direction,
			amount_minor,
			currency,
			long_description,
			short_description,
			category_id,
			rule_version,
			rule_priority,
			metadata
		)
        ON CONFLICT (transaction_type, external_id, occurred_at) DO NOTHING
        RETURNING 1`,
		[
			transactions.map((t) => t.userId), // 1
			transactions.map((t) => t.accountId), // 2
			transactions.map((t) => t.transactionType), // 3
			transactions.map((t) => t.externalId), // 4
			transactions.map((t) => t.occurredAt), // 5
			transactions.map((t) => t.direction), // 6
			transactions.map((t) => t.amountMinor), // 7
			transactions.map((t) => t.currency), // 8
			transactions.map((t) => t.longDescription), // 9
			transactions.map((t) => t.shortDescription), // 10
			transactions.map((t) => t.categoryId), // 11
			transactions.map((t) => t.ruleVersion), // 12
			transactions.map((t) => t.rulePriority), // 13
			transactions.map((t) => JSON.stringify(t.metadata)) // 14 — string[] cast by $14::jsonb[]
		]
	);
	return { attempted: transactions.length, inserted: result.rowCount ?? 0 };
}
