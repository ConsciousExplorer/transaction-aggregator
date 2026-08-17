import type { Pool } from "pg";
import type z from "zod";
import type { canonicalTransactionSchema } from "#src/domain/transaction.ts";

// Fallback - TODO - implement categorsation and then remove the fallback! NB!
const FALLBACK_CATEGORY = "uncategorized";
const ruleVersion = 1; // TODO: Update from categorser

export async function batchInsertTransactions(
	pool: Pool,
	txns: z.infer<typeof canonicalTransactionSchema>[]
): Promise<{ attempted: number; inserted: number }> {
	if (txns.length === 0) return { attempted: 0, inserted: 0 };

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
			(SELECT category_id FROM categories WHERE name = $13),
			$14::int,
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
        	$12::jsonb[])
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
			metadata
		)
        ON CONFLICT (source, external_id, occurred_at) DO NOTHING
        RETURNING 1`,
		[
			txns.map((t) => t.userId), // 1
			txns.map((t) => t.source), // 2
			txns.map((t) => t.externalId), // 3
			txns.map((t) => t.occuredAt), // 4
			txns.map((t) => t.postedAt), // 5
			txns.map((t) => t.direction), // 6
			txns.map((t) => t.amountMinor), // 7
			txns.map((t) => t.currency), // 8
			txns.map((t) => t.description), // 9
			txns.map((t) => t.merchantName), // 10
			txns.map((t) => t.mcc), // 11
			txns.map((t) => JSON.stringify(t.metadata)), // 12 — string[] cast by $12::jsonb[]

			// TODO: implement categorization
			FALLBACK_CATEGORY, // 13 — scalar, same for the whole batch
			ruleVersion // 14 — scalar, same for the whole batch
		]
	);
	return { attempted: txns.length, inserted: result.rowCount ?? 0 };
}
