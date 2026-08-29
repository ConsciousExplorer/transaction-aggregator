import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import z from "zod";
import type { Queryable } from "../pool.ts";
import { transactions } from "../schemas/partitioned.ts";

export const userTransactionFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	source: z.string().optional(),
	categoryId: z.number().int().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional(),
	cursorOccurredAt: z.iso.datetime().optional(),
	cursorTransactionId: z.uuid().optional(),
	limit: z.number().int().min(1).max(100).default(50)
});

export const userTransactionDetailFilter = z.object({
	userId: z.string(),
	transactionId: z.string()
});

const databaseResponseSchema = z.object({
	transaction_id: z.uuid(),
	occurred_at: z.coerce.date(),
	source: z.string(),
	direction: z.enum(["debit", "credit"]),
	amount_minor: z.coerce.number(),
	currency: z.string(),
	category_id: z.number().int(),
	merchant_name: z.string().nullable()
});

export type UserTransactionFilter = z.infer<typeof userTransactionFilter>;
export type UserTransactionDetailFilter = z.infer<
	typeof userTransactionDetailFilter
>;

export async function getUserTransactions(
	db: Queryable,
	filter: UserTransactionFilter
) {
	const result = await db.query<z.infer<typeof databaseResponseSchema>>(
		`
        SELECT t.transaction_id, t.occurred_at,
            t.source, 
            t.direction, 
            t.amount_minor, 
            t.currency,
            COALESCE(txo.category_id, uco.to_category_id, t.category_id) AS category_id,  -- v3: effective (parent §2.5)
            t.merchant_name
        FROM   transactions t
        LEFT JOIN user_transaction_overrides txo ON txo.transaction_id = t.transaction_id AND txo.occurred_at = t.occurred_at
        LEFT JOIN user_category_overrides   uco ON uco.user_id = t.user_id AND uco.from_category_id = t.category_id
        WHERE  t.user_id = $1
        AND  t.occurred_at >= $2 AND t.occurred_at < $3
        AND  ($4::source_type    IS NULL OR t.source    = $4)
        AND  ($5::smallint       IS NULL OR COALESCE(txo.category_id, uco.to_category_id, t.category_id) = $5)  -- filter on EFFECTIVE
        AND  ($6::direction_type IS NULL OR t.direction = $6)
        AND  ($7::bigint         IS NULL OR t.amount_minor >= $7)
        AND  ($8::bigint         IS NULL OR t.amount_minor <= $8)
        AND  ($9::timestamptz    IS NULL OR (t.occurred_at, t.transaction_id) < ($9, $10::uuid))   -- keyset: strictly before cursor row
        ORDER BY t.occurred_at DESC, t.transaction_id DESC
        LIMIT  $11;  
        `,
		[
			filter.userId, // 1
			filter.fromDate, // 2
			filter.toDate, // 3
			filter.source ?? null, // 4
			filter.categoryId ?? null, // 5
			filter.direction ?? null, // 6
			filter.amountMin ?? null, // 7
			filter.amountMax ?? null, // 8
			filter.cursorOccurredAt ?? null, // 9
			filter.cursorTransactionId ?? null, // 10
			filter.limit // 11
		]
	);

	// Parse database rows at the boundary
	const parsedRecord = databaseResponseSchema.array().parse(result.rows);
	return parsedRecord;
}

export async function getUserTransactionDetail(
	db: Queryable,
	filter: UserTransactionDetailFilter
) {
	const result = await drizzle(db)
		.select()
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, filter.userId),
				eq(transactions.transactionId, filter.transactionId)
			)
		);

	console.log(result);

	// Parse database rows at the boundary
	const parsedResponse = databaseResponseSchema.parse(result[0]);
	return parsedResponse;
}
