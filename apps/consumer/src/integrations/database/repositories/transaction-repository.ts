import type z from "zod";
import type { categorizedTransactionSchema } from "#src/domain/transaction.ts";
import type { Queryable } from "../pool.ts";

export async function batchInsertTransactions(
	db: Queryable,
	transactions: z.infer<typeof categorizedTransactionSchema>[]
): Promise<{ attempted: number; inserted: number }> {
	if (transactions.length === 0) return { attempted: 0, inserted: 0 };

	const result = await db.query(
		`
        INSERT INTO transactions
        (
			user_id,
			account_id,
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
			t.account_id,
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
			$2::uuid[],
			$3::source_type[],
			$4::text[],
			$5::timestamptz[],
        	$6::timestamptz[],
			$7::direction_type[],
			$8::bigint[],
			$9::text[],
			$10::text[],
			$11::text[],
			$12::char(4)[],
			$13::bigint[],
			$14::bigint[],
			$15::bigint[],
        	$16::jsonb[])
		AS t (
			user_id,
			account_id,
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
			transactions.map((t) => t.accountId), // 2
			transactions.map((t) => t.source), // 3
			transactions.map((t) => t.externalId), // 4
			transactions.map((t) => t.occurredAt), // 5
			transactions.map((t) => t.postedAt), // 6
			transactions.map((t) => t.direction), // 7
			transactions.map((t) => t.amountMinor), // 8
			transactions.map((t) => t.currency), // 9
			transactions.map((t) => t.description), // 10
			transactions.map((t) => t.merchantName), // 11
			transactions.map((t) => t.mcc), // 12
			transactions.map((t) => t.categoryId), // 13
			transactions.map((t) => t.ruleVersion), // 14
			transactions.map((t) => t.rulePriority), // 15
			transactions.map((t) => JSON.stringify(t.metadata)) // 16 — string[] cast by $16::jsonb[]
		]
	);
	return { attempted: transactions.length, inserted: result.rowCount ?? 0 };
}
