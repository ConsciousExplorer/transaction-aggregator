import {
	and,
	desc,
	eq,
	gte,
	inArray,
	lt,
	lte,
	type SQL,
	sql
} from "drizzle-orm";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import z from "zod";
import type { AppCradle } from "#src/container.ts";
import { sourceSchema } from "#src/schemas/common.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export const userTransactionFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	accountId: z.union([z.string(), z.string().array()]).optional(),
	source: z.union([sourceSchema, sourceSchema.array()]).optional(),
	category: z.union([z.string(), z.string().array()]).optional(),
	direction: z
		.union([z.enum(["debit", "credit"]), z.enum(["debit", "credit"]).array()])
		.optional(),
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

export class TransactionRepository {
	dbClient: NodePgClient;

	constructor({ database }: AppCradle) {
		this.dbClient = database;
	}

	async getUserTransactions(filter: UserTransactionFilter) {
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;
		const categoryValues =
			filter.category === undefined
				? undefined
				: Array.isArray(filter.category)
					? filter.category
					: [filter.category];

		const conditions: (SQL | undefined)[] = [
			eq(transactions.userId, filter.userId),
			gte(transactions.occurredAt, filter.fromDate),
			lt(transactions.occurredAt, filter.toDate),
			filter.source !== undefined
				? Array.isArray(filter.source)
					? inArray(transactions.source, filter.source)
					: eq(transactions.source, filter.source)
				: undefined,
			filter.direction !== undefined
				? Array.isArray(filter.direction)
					? inArray(transactions.direction, filter.direction)
					: eq(transactions.direction, filter.direction)
				: undefined,
			filter.amountMin !== undefined
				? gte(transactions.amountMinor, filter.amountMin)
				: undefined,
			filter.amountMax !== undefined
				? lte(transactions.amountMinor, filter.amountMax)
				: undefined,
			categoryValues && categoryValues.length > 0
				? inArray(categories.category, categoryValues)
				: undefined,
			filter.cursorOccurredAt !== undefined &&
			filter.cursorTransactionId !== undefined
				? sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${filter.cursorOccurredAt}::timestamptz, ${filter.cursorTransactionId}::uuid)`
				: undefined
		];

		const result = await drizzle(this.dbClient)
			.select({
				transactionId: transactions.transactionId,
				occurredAt: transactions.occurredAt,
				source: transactions.source,
				direction: transactions.direction,
				amountMinor: transactions.amountMinor,
				currency: transactions.currency,
				category: categories.category, // D32: the slug, straight from the join
				merchantName: transactions.merchantName
			})
			.from(transactions)
			.leftJoin(
				userTransactionOverrides,
				and(
					eq(
						userTransactionOverrides.transactionId,
						transactions.transactionId
					),
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
			.orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))
			.limit(filter.limit);

		return result;
	}

	async getUserTransactionDetail(filter: UserTransactionDetailFilter) {
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;

		const [result] = await drizzle(this.dbClient)
			.select({
				transactionId: transactions.transactionId,
				occurredAt: transactions.occurredAt,
				source: transactions.source,
				direction: transactions.direction,
				amountMinor: transactions.amountMinor,
				currency: transactions.currency,
				category: categories.category, // D32: the slug, straight from the join
				merchantName: transactions.merchantName
			})
			.from(transactions)
			.leftJoin(
				userTransactionOverrides,
				and(
					eq(
						userTransactionOverrides.transactionId,
						transactions.transactionId
					),
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
			.where(
				and(
					eq(transactions.userId, filter.userId),
					eq(transactions.transactionId, filter.transactionId)
				)
			);

		return result;
	}

	async upsertUserTransactionCategory(
		transaction: UserTransactionUpdateDetail
	) {
		const [result] = await drizzle(this.dbClient)
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

		return result;
	}
}
