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
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import z from "zod";
import type { AppCradle } from "#src/container.ts";
import {
	creditDebitIndicatorSchema,
	transactionCursorSchema,
	transactionSortSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
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
	creditDebitIndicator: z
		.union([creditDebitIndicatorSchema, creditDebitIndicatorSchema.array()])
		.optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional(),
	// The order rows are read in
	sort: transactionSortSchema.default("-occurredAt"),
	// Left out to read from the start. Otherwise only the rows after this
	// keyset, in sort order.
	cursor: transactionCursorSchema.optional(),
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
	db: NodePgDatabase;

	constructor({ db }: AppCradle) {
		this.db = db;
	}

	async getTransactions(filter: ListTransactionsFilter) {
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;
		const categoryValues =
			filter.category === undefined
				? undefined
				: Array.isArray(filter.category)
					? filter.category
					: [filter.category];

		const ascending = filter.sort === "occurredAt";

		// The cursor conditions go before the window. Postgres starts each
		// partition's index scan at the first occurred_at bound it finds, so with
		// the window first a deep page walks every entry from toDateTime down to
		// the cursor. The plain bound repeats the row comparison's first column,
		// which is what an ascending (backward) scan can start from.
		let cursorBound: SQL | undefined;
		let cursorSeek: SQL | undefined;
		if (filter.cursor !== undefined) {
			const { occurredAt, transactionId } = filter.cursor;
			if (ascending) {
				cursorBound = gte(transactions.occurredAt, occurredAt);
				cursorSeek = sql`(${transactions.occurredAt}, ${transactions.transactionId}) > (${occurredAt}::timestamptz, ${transactionId}::uuid)`;
			} else {
				cursorBound = lte(transactions.occurredAt, occurredAt);
				cursorSeek = sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${occurredAt}::timestamptz, ${transactionId}::uuid)`;
			}
		}

		const conditions: (SQL | undefined)[] = [
			eq(transactions.userId, filter.userId),
			cursorBound,
			cursorSeek,
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
			filter.creditDebitIndicator !== undefined
				? Array.isArray(filter.creditDebitIndicator)
					? inArray(
							transactions.creditDebitIndicator,
							filter.creditDebitIndicator
						)
					: eq(transactions.creditDebitIndicator, filter.creditDebitIndicator)
				: undefined,
			filter.amountMin !== undefined
				? gte(transactions.amountMinor, filter.amountMin)
				: undefined,
			filter.amountMax !== undefined
				? lte(transactions.amountMinor, filter.amountMax)
				: undefined,
			categoryValues && categoryValues.length > 0
				? inArray(categories.category, categoryValues)
				: undefined
		];

		const order = ascending
			? [asc(transactions.occurredAt), asc(transactions.transactionId)]
			: [desc(transactions.occurredAt), desc(transactions.transactionId)];

		const result = await this.db
			.select({
				transactionId: transactions.transactionId,
				occurredAt: transactions.occurredAt,
				transactionType: transactions.transactionType,
				creditDebitIndicator: transactions.creditDebitIndicator,
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

		const [result] = await this.db
			.select({
				transactionId: transactions.transactionId,
				accountId: transactions.accountId,
				externalId: transactions.externalId,
				occurredAt: transactions.occurredAt,
				creditDebitIndicator: transactions.creditDebitIndicator,
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
			// No occurred_at bound: the id's time is when the row was inserted, not
			// when the transaction happened, so it can't name the partition. Every
			// partition's primary key index starts with transaction_id, so this is
			// one index lookup per partition.
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
			const [result] = await this.db
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
		// No occurred_at bound, as in getTransactionDetail: one primary key index
		// lookup per partition
		const [result] = await this.db
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
