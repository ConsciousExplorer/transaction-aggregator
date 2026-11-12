import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gte,
	isNull,
	lt,
	lte,
	sql
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AppCradle } from "#src/container.ts";
import type { CursorDirection } from "#src/schemas/common.ts";
import type {
	TransactionKeyset,
	TransactionPageCursor,
	TransactionSort
} from "#src/schemas/transactions.ts";
import { isForeignKeyViolation } from "../pool.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";
import { buildKeysetPage } from "./keyset-page.ts";
import {
	buildFilterConditions,
	categoryOverrideJoin,
	effectiveCategoryJoin,
	type TransactionFilter,
	transactionOverrideJoin
} from "./transaction-conditions.ts";

/** GET .../transactions: the filters, plus the page to seek */
export interface TransactionPageFilter extends TransactionFilter {
	/** The order the client asked for. Every page comes back in it. */
	sort: TransactionSort;
	/** Where to continue from and which way. Left out for the first page. */
	cursor?: TransactionPageCursor | undefined;
	/** The most rows a page holds */
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

/**
 * The order a page is read in. next continues in the requested sort order.
 * prev reads against it from the cursor, so that LIMIT keeps the rows nearest
 * the cursor rather than the furthest; buildKeysetPage flips them back.
 */
export function chooseReadSort(
	requestedSort: TransactionSort,
	direction: CursorDirection
) {
	if (direction === "next") {
		return requestedSort;
	}
	if (requestedSort === "occurredAt") {
		return "-occurredAt";
	}
	return "occurredAt";
}

/**
 * The rows past a keyset position, in the order read. No conditions for the
 * first page, which has no position to seek from.
 *
 * Beside the row comparison goes a plain bound on occurred_at alone, which
 * keeps the same rows. Partition pruning can't use a row comparison, so
 * without the plain bound a deep page also scans every partition between the
 * window's edge and the cursor. With it, those partitions are pruned, and each
 * scan starts at the cursor's timestamp, not the window's edge.
 */
function buildSeekConditions(
	position: TransactionKeyset | undefined,
	readSort: TransactionSort
) {
	if (position === undefined) return [];

	const { occurredAt, transactionId } = position;
	if (readSort === "occurredAt") {
		return [
			gte(transactions.occurredAt, occurredAt),
			sql`(${transactions.occurredAt}, ${transactions.transactionId}) > (${occurredAt}::timestamptz, ${transactionId}::uuid)`
		];
	}
	return [
		lte(transactions.occurredAt, occurredAt),
		sql`(${transactions.occurredAt}, ${transactions.transactionId}) < (${occurredAt}::timestamptz, ${transactionId}::uuid)`
	];
}

/** The keyset columns, both ascending or both descending */
function buildSeekOrder(readSort: TransactionSort) {
	if (readSort === "occurredAt") {
		return [asc(transactions.occurredAt), asc(transactions.transactionId)];
	}
	return [desc(transactions.occurredAt), desc(transactions.transactionId)];
}

/** The columns of a row that a cursor is built from */
interface PageBoundaryRow {
	transactionId: string;
	cursorOccurredAt: string;
}

/** The cursor that continues from a page's first or last row */
function buildPageCursor(
	boundaryRow: PageBoundaryRow,
	direction: CursorDirection
) {
	return {
		direction,
		position: {
			occurredAt: boundaryRow.cursorOccurredAt,
			transactionId: boundaryRow.transactionId
		}
	};
}

export class UserTransactionRepository {
	readonly #database: NodePgDatabase;

	constructor({ database }: Pick<AppCradle, "database">) {
		this.#database = database;
	}

	/**
	 * One page of a user's transactions, in the requested sort order, with the
	 * cursors of the pages on either side of it (null when there is none).
	 */
	async seekTransactionPage(filter: TransactionPageFilter) {
		const direction = filter.cursor?.direction ?? "next";
		const readSort = chooseReadSort(filter.sort, direction);

		const conditions = [
			eq(transactions.userId, filter.userId),
			gte(transactions.occurredAt, filter.fromDateTime),
			lt(transactions.occurredAt, filter.toDateTime),
			...buildSeekConditions(filter.cursor?.position, readSort),
			...buildFilterConditions(filter)
		];

		const fetched = await this.#database
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
			.orderBy(...buildSeekOrder(readSort))
			// One row more than a page holds. It is never returned: it only
			// proves that another page exists in the direction read.
			.limit(filter.limit + 1);

		const page = buildKeysetPage(
			fetched,
			filter.limit,
			direction,
			filter.cursor !== undefined
		);

		return {
			rows: page.rows,
			nextCursor: page.nextFrom ? buildPageCursor(page.nextFrom, "next") : null,
			previousCursor: page.previousFrom
				? buildPageCursor(page.previousFrom, "prev")
				: null
		};
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
				// An insert writes created_at and updated_at from the same now();
				// the conflict branch writes updated_at alone.
				.returning({
					...getTableColumns(userTransactionOverrides),
					inserted: sql<boolean>`(created_at = updated_at)`
				});

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
