import { and, desc, eq, gte, lt, lte, type SQL, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import z from "zod";
import { sourceSchema } from "#src/schemas/common.ts";
import type { Queryable } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export const userSummaryFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	source: sourceSchema.optional(), // must be the enum literal union: eq(transactions.source, …) is typed by the pgEnum
	category: z.string().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional()
});

export type UserSummaryFilter = z.infer<typeof userSummaryFilter>;

export async function getUserSummary(db: Queryable, filter: UserSummaryFilter) {
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
		filter.category !== undefined
			? eq(effectiveCategoryId, filter.category)
			: undefined
	];

	const result = await drizzle(db)
		.select({
			category: categories.category,
			currency: transactions.currency,
			amount: sum(transactions.amountMinor)
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
		.innerJoin(categories, eq(categories.categoryId, effectiveCategoryId))
		.where(and(...conditions))
		.groupBy(categories.category, transactions.currency);

	return result;
}
