import {
	and,
	asc,
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
import {
	type TransactionSort,
	transactionSortSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import type { CursorDirection } from "#src/utils/paging.ts";
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
	accountId: z.union([z.uuid(), z.uuid().array()]).optional(),
	transactionType: z
		.union([transactionTypeSchema, transactionTypeSchema.array()])
		.optional(),
	category: z.union([z.string(), z.string().array()]).optional(),
	direction: z
		.union([z.enum(["debit", "credit"]), z.enum(["debit", "credit"]).array()])
		.optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional(),
	sort: transactionSortSchema.default("-occurredAt"),
	cursorOccurredAt: z.iso.datetime().optional(),
	cursorTransactionId: z.uuid().optional(),
	// next: the rows after the cursor in sort order. prev: the rows before it,
	// read the other way; the caller flips them back.
	cursorDirection: z.enum(["next", "prev"]).default("next"),
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

/**
 * Whether a page is read in ascending (occurred_at, transaction_id) order.
 * next continues in the sort order. prev reads against it from the cursor,
 * so that LIMIT keeps the rows nearest the cursor rather than the furthest.
 */
export function isAscendingRead(
	sort: TransactionSort,
	cursorDirection: CursorDirection
): boolean {
	const sortAscending = sort === "occurredAt";
	if (cursorDirection === "next") {
		return sortAscending;
	}
	return !sortAscending;
}

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

		const ascending = isAscendingRead(filter.sort, filter.cursorDirection);

		const conditions: (SQL | undefined)[] = [
			eq(transactions.userId, filter.userId),
			gte(transactions.occurredAt, filter.fromDateTime),
			lt(transactions.occurredAt, filter.toDateTime),
			filter.accountId !== undefined
				? Array.isArray(filter.accountId)
					? inArray(transactions.accountId, filter.accountId)
					: eq(transactions.accountId, filter.accountId)
				: undefined,
			filter.transactionType !== undefined
				? Array.isArray(filter.transactionType)
					? inArray(transactions.transactionType, filter.transactionType)
					: eq(transactions.transactionType, filter.transactionType)
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
				? ascending
					? sql`(${transactions.occurredAt}, ${transactions.transactionId}) > (${filter.cursorOccurredAt}::timestamptz, ${filter.cursorTransactionId}::uuid)`
					: sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${filter.cursorOccurredAt}::timestamptz, ${filter.cursorTransactionId}::uuid)`
				: undefined
		];

		const order = ascending
			? [asc(transactions.occurredAt), asc(transactions.transactionId)]
			: [desc(transactions.occurredAt), desc(transactions.transactionId)];

		const result = await drizzle(this.dbClient)
			.select({
				transactionId: transactions.transactionId,
				occurredAt: transactions.occurredAt,
				transactionType: transactions.transactionType,
				direction: transactions.direction,
				status: transactions.status,
				amountMinor: transactions.amountMinor,
				currency: transactions.currency,
				category: categories.category,
				shortDescription: transactions.shortDescription,
				// occurred_at to the microsecond, as UTC ISO text, for the next page's
				// keyset bound. Rows can differ only in microseconds, so a millisecond
				// bound would skip or repeat them.
				cursorOccurredAt: sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
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
			.orderBy(...order)
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
				direction: transactions.direction,
				status: transactions.status,
				longDescription: transactions.longDescription,
				amountMinor: transactions.amountMinor,
				transactionType: transactions.transactionType,
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
