import {
	and,
	asc,
	desc,
	eq,
	gte,
	isNull,
	lt,
	lte,
	type SQL,
	sql
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AppCradle } from "#src/container.ts";
import type {
	TransactionCursor,
	TransactionSort
} from "#src/schemas/transactions.ts";
import { isForeignKeyViolation } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";
import {
	buildFilterConditions,
	categoryOverrideJoin,
	effectiveCategoryJoin,
	type TransactionFilter,
	transactionOverrideJoin
} from "./transaction-conditions.ts";

/** GET .../transactions: the filters, plus the page to read */
export interface ListTransactionsFilter extends TransactionFilter {
	sort: TransactionSort;
	cursor?: TransactionCursor | undefined;
	limit: number;
}

/** GET .../transactions/:transactionId */
export interface TransactionDetailFilter {
	userId: string;
	transactionId: string;
}

/** PUT .../transaction-overrides/:transactionId */
export interface SetTransactionCategory {
	userId: string;
	transactionId: string;
	occurredAt: string;
	categoryId: number;
}

export class UserTransactionRepository {
	readonly #database: NodePgDatabase;

	constructor({ database }: AppCradle) {
		this.#database = database;
	}

	async getTransactions(filter: ListTransactionsFilter) {
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

		const conditions = [
			eq(transactions.userId, filter.userId),
			cursorBound,
			cursorSeek,
			gte(transactions.occurredAt, filter.fromDateTime),
			lt(transactions.occurredAt, filter.toDateTime),
			...buildFilterConditions(filter)
		];

		const order = ascending
			? [asc(transactions.occurredAt), asc(transactions.transactionId)]
			: [desc(transactions.occurredAt), desc(transactions.transactionId)];

		const rows = await this.#database
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
				cursorOccurredAt: sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
			})
			.from(transactions)
			.leftJoin(userTransactionOverrides, transactionOverrideJoin)
			.leftJoin(userCategoryOverrides, categoryOverrideJoin)
			.innerJoin(categories, effectiveCategoryJoin)
			.where(and(...conditions))
			.orderBy(...order)
			.limit(filter.limit);

		return rows;
	}

	async getTransactionDetail(filter: TransactionDetailFilter) {
		const [result] = await this.#database
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
				category: categories.category,
				shortDescription: transactions.shortDescription,
				metadata: transactions.metadata
			})
			.from(transactions)
			.leftJoin(userTransactionOverrides, transactionOverrideJoin)
			.leftJoin(userCategoryOverrides, categoryOverrideJoin)
			.innerJoin(categories, effectiveCategoryJoin)
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
			const [result] = await this.#database
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
		await this.#database
			.update(userTransactionOverrides)
			.set({ archivedAt: sql`now()` })
			.where(
				and(
					eq(userTransactionOverrides.userId, userId),
					eq(userTransactionOverrides.transactionId, transactionId),
					isNull(userTransactionOverrides.archivedAt)
				)
			);
	}
}
