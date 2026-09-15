import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	type SQL,
	sql
} from "drizzle-orm";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import z from "zod";
import type { AppCradle } from "#src/container.ts";
import { sourceSchema } from "#src/schemas/transactions.ts";
import { isForeignKeyViolation } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

// Filters/params for GET .../transactions (list + query string).
export const listTransactionsFilterSchema = z.object({
	userId: z.string(),
	fromDateTime: z.iso.datetime(),
	toDateTime: z.iso.datetime(),
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

// Params for GET .../transactions/:transactionId (single-row lookup).
export const transactionDetailFilterSchema = z.object({
	userId: z.string(),
	transactionId: z.string()
});

// Body for PUT .../transactions/:transactionId/category
export const setTransactionCategorySchema = z.object({
	userId: z.string(),
	transactionId: z.string(),
	occurredAt: z.iso.datetime(),
	categoryId: z.number().int()
});

export type ListTransactionsFilter = z.infer<
	typeof listTransactionsFilterSchema
>;
export type TransactionDetailFilter = z.infer<
	typeof transactionDetailFilterSchema
>;
export type SetTransactionCategory = z.infer<
	typeof setTransactionCategorySchema
>;

export class UserTransactionRepository {
	dbClient: NodePgClient;

	constructor({ database }: AppCradle) {
		this.dbClient = database;
	}

	async getTransactions(filter: ListTransactionsFilter) {
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;
		const categoryValues =
			filter.category === undefined
				? undefined
				: Array.isArray(filter.category)
					? filter.category
					: [filter.category];

		const conditions: (SQL | undefined)[] = [
			eq(transactions.userId, filter.userId),
			gte(transactions.occurredAt, filter.fromDateTime),
			lt(transactions.occurredAt, filter.toDateTime),
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
				category: categories.category,
				shortDescription: transactions.shortDescription
			})
			.from(transactions)
			.leftJoin(
				userTransactionOverrides,
				and(
					eq(
						userTransactionOverrides.transactionId,
						transactions.transactionId
					),
					eq(userTransactionOverrides.occurredAt, transactions.occurredAt),
					isNull(userTransactionOverrides.archivedAt)
				)
			)
			.leftJoin(
				userCategoryOverrides,
				and(
					eq(userCategoryOverrides.userId, transactions.userId),
					eq(userCategoryOverrides.fromCategoryId, transactions.categoryId),
					isNull(userCategoryOverrides.archivedAt)
				)
			)
			.innerJoin(categories, eq(categories.categoryId, effectiveCategoryId))
			.where(and(...conditions))
			.orderBy(desc(transactions.occurredAt), desc(transactions.transactionId))
			.limit(filter.limit);

		return result;
	}

	async getTransactionDetail(filter: TransactionDetailFilter) {
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;

		const [result] = await drizzle(this.dbClient)
			.select({
				transactionId: transactions.transactionId,
				accountId: transactions.accountId,
				externalId: transactions.externalId,
				occurredAt: transactions.occurredAt,
				postedAt: transactions.postedAt,
				direction: transactions.direction,
				longDescription: transactions.longDescription,
				amountMinor: transactions.amountMinor,
				source: transactions.source,
				currency: transactions.currency,
				categoryId: effectiveCategoryId,
				category: categories.category,
				shortDescription: transactions.shortDescription,
				metadata: transactions.metadata
			})
			.from(transactions)
			.leftJoin(
				userTransactionOverrides,
				and(
					eq(
						userTransactionOverrides.transactionId,
						transactions.transactionId
					),
					eq(userTransactionOverrides.occurredAt, transactions.occurredAt),
					isNull(userTransactionOverrides.archivedAt)
				)
			)
			.leftJoin(
				userCategoryOverrides,
				and(
					eq(userCategoryOverrides.userId, transactions.userId),
					eq(userCategoryOverrides.fromCategoryId, transactions.categoryId),
					isNull(userCategoryOverrides.archivedAt)
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

	async setTransactionCategory(transaction: SetTransactionCategory) {
		try {
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
					set: {
						categoryId: transaction.categoryId,
						updatedAt: sql`now()`,
						archivedAt: null
					}
				})
				.returning();

			return result;
		} catch (error) {
			if (isForeignKeyViolation(error)) return undefined;
			throw error;
		}
	}

	async archiveTransactionCategory(userId: string, transactionId: string) {
		const [result] = await drizzle(this.dbClient)
			.update(userTransactionOverrides)
			.set({ archivedAt: sql`now()` })
			.where(
				and(
					eq(userTransactionOverrides.userId, userId),
					eq(userTransactionOverrides.transactionId, transactionId),
					isNull(userTransactionOverrides.archivedAt)
				)
			)
			.returning();

		return result;
	}
}
