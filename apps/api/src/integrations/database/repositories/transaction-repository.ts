import { and, desc, eq, gte, lt, lte, SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import z from "zod";
import { sourceSchema } from "#src/schemas/common.ts";
import type { Queryable } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { userCategoryOverrides } from "../schemas/schema.ts";

export const userTransactionFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	source: sourceSchema.optional(), // must be the enum literal union: eq(transactions.source, …) is typed by the pgEnum
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

export type UserTransactionFilter = z.infer<typeof userTransactionFilter>;
export type UserTransactionDetailFilter = z.infer<
	typeof userTransactionDetailFilter
>;

export async function getUserTransactions(
	db: Queryable,
	filter: UserTransactionFilter
) {
	// Referenced twice (select + where); define once so both stay in sync.
	const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;

	const conditions: (SQL | undefined)[] = [
		eq(transactions.userId, filter.userId),
		gte(transactions.occurredAt, filter.fromDate),
		lt(transactions.occurredAt, filter.toDate),
		filter.source !== undefined
			? eq(transactions.source, filter.source)
			: undefined,
		filter.direction !== undefined
			? eq(transactions.direction, filter.direction)
			: undefined,
		filter.amountMin !== undefined
			? gte(transactions.amountMinor, filter.amountMin)
			: undefined,
		filter.amountMax !== undefined
			? lte(transactions.amountMinor, filter.amountMax)
			: undefined,
		filter.categoryId !== undefined
			? eq(effectiveCategoryId, filter.categoryId)
			: undefined,
		filter.cursorOccurredAt !== undefined &&
		filter.cursorTransactionId !== undefined
			? sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${filter.cursorOccurredAt}::timestamptz, ${filter.cursorTransactionId}::uuid)`
			: undefined
	];

	const result = drizzle(db)
		.select({
			transactionId: transactions.transactionId,
			occurredAt: transactions.occurredAt,
			source: transactions.source,
			direction: transactions.direction,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			categoryId: effectiveCategoryId.as("category_id"),
			merchantName: transactions.merchantName
		})
		.from(transactions)
		.leftJoin(
			userTransactionOverrides,
			and(
				eq(userTransactionOverrides.transactionId, transactions.transactionId),
				eq(userTransactionOverrides.occurredAt, transactions.occurredAt)
			)
		)
		.leftJoin(
			userCategoryOverrides,
			and(
				eq(userCategoryOverrides.userId, transactions.userId),
				eq(userCategoryOverrides.fromCategoryId, transactions.categoryId)
			)
		)
		.where(and(...conditions))
		.orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))
		.limit(filter.limit);

	console.log(result);
	return result;
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

	return result[0];
}
