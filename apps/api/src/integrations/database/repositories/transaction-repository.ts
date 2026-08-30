import { and, desc, eq, gte, lt, lte, SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import z from "zod";
import { sourceSchema } from "#src/schemas/common.ts";
import type { Queryable } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export const userTransactionFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	source: sourceSchema.optional(), // must be the enum literal union: eq(transactions.source, …) is typed by the pgEnum
	category: z.string().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional(),
	cursorOccurredAt: z.iso.datetime().optional(),
	cursorTransactionId: z.uuid().optional(),
	limit: z.number().int().min(1).max(100).default(50)
});

export const userTransactionUpdateDetail = z.object({
	userId: z.string(),
	transactionId: z.string(),
	occurredAt: z.iso.datetime(),
	categoryId: z.number().int()
});

export const userTransactionDetailFilter = z.object({
	userId: z.string(),
	transactionId: z.string()
});

export type UserTransactionFilter = z.infer<typeof userTransactionFilter>;
export type UserTransactionDetailFilter = z.infer<
	typeof userTransactionDetailFilter
>;
export type UserTransactionUpdateDetail = z.infer<
	typeof userTransactionUpdateDetail
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
		filter.category !== undefined
			? eq(effectiveCategoryId, filter.category)
			: undefined,
		filter.cursorOccurredAt !== undefined &&
		filter.cursorTransactionId !== undefined
			? sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${filter.cursorOccurredAt}::timestamptz, ${filter.cursorTransactionId}::uuid)`
			: undefined
	];

	const result = await drizzle(db)
		.select({
			transactionId: transactions.transactionId,
			occurredAt: transactions.occurredAt,
			source: transactions.source,
			direction: transactions.direction,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			category: categories.name, // D32: the slug, straight from the join
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
		.innerJoin(categories, eq(categories.name, effectiveCategoryId)) // LAST — its ON references both left joins
		.where(and(...conditions))
		.orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))
		.limit(filter.limit);

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

export async function upsertUserTransactionCategory(
	db: Queryable,
	transaction: UserTransactionUpdateDetail
) {
	const result = await drizzle(db)
		.insert(userTransactionOverrides)
		.values({
			userId: transaction.userId,
			transactionId: transaction.transactionId,
			occurredAt: transaction.occurredAt,
			categoryId: transaction.categoryId
		})
		.onConflictDoUpdate({
			target: [
				userTransactionOverrides.transactionId,
				userTransactionOverrides.occurredAt
			],
			set: { categoryId: transaction.categoryId }
		})
		.returning();

	return result[0];
}
