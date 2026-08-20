import type { Pool } from "pg";
import type z from "zod";
import type { categorizedTransactionSchema } from "#src/domain/transaction.ts";

export async function batchInsertTransactions(
	pool: Pool,
	transactions: z.infer<typeof categorizedTransactionSchema>[]
): Promise<{ attempted: number; inserted: number }> {
	if (transactions.length === 0) return { attempted: 0, inserted: 0 };

	const result = await pool.query(
		`
        INSERT INTO transactions
        (
			user_id,
			source,
			external_id,
			occurred_at,
			posted_at,
			direction,
			amount_minor,
			currency,
			description,
			merchant_name,
			mcc,
			category_id,
        	rule_version,
			rule_priority,
			metadata
		)
        SELECT
			t.user_id,
			t.source,
			t.external_id,
			t.occurred_at,
			t.posted_at,
			t.direction,
			t.amount_minor,
			t.currency,
			t.description,
			t.merchant_name,
			t.mcc,
			t.category_id,
			t.rule_version,
			t.rule_priority,
			t.metadata
		FROM unnest(
        	$1::uuid[],
			$2::source_type[],
			$3::text[],
			$4::timestamptz[],
        	$5::timestamptz[],
			$6::direction_type[],
			$7::bigint[],
			$8::text[],
			$9::text[],
			$10::text[],
			$11::char(4)[],
			$12::bigint[],
			$13::bigint[],
			$14::bigint[],
        	$15::jsonb[])
		AS t (
			user_id,
			source,
			external_id,
			occurred_at,
			posted_at,
			direction,
			amount_minor,
			currency,
			description,
			merchant_name,
			mcc,
			category_id,
			rule_version,
			rule_priority,
			metadata
		)
        ON CONFLICT (source, external_id, occurred_at) DO NOTHING
        RETURNING 1`,
		[
			transactions.map((t) => t.userId), // 1
			transactions.map((t) => t.source), // 2
			transactions.map((t) => t.externalId), // 3
			transactions.map((t) => t.occurredAt), // 4
			transactions.map((t) => t.postedAt), // 5
			transactions.map((t) => t.direction), // 6
			transactions.map((t) => t.amountMinor), // 7
			transactions.map((t) => t.currency), // 8
			transactions.map((t) => t.description), // 9
			transactions.map((t) => t.merchantName), // 10
			transactions.map((t) => t.mcc), // 11
			transactions.map((t) => t.categoryId), // 12
			transactions.map((t) => t.ruleVersion), // 13
			transactions.map((t) => t.rulePriority), // 14
			transactions.map((t) => JSON.stringify(t.metadata)) // 15 — string[] cast by $15::jsonb[]
		]
	);
	return { attempted: transactions.length, inserted: result.rowCount ?? 0 };
}
