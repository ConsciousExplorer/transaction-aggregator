import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type {
	CreditDebitIndicator,
	TransactionType
} from "#src/schemas/transactions.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

/** What the transaction list and the summary both filter on. */
export interface TransactionFilter {
	userId: string;
	fromDateTime: string;
	toDateTime: string;
	accountId?: string | string[] | undefined;
	transactionType?: TransactionType | TransactionType[] | undefined;
	category?: string | string[] | undefined;
	creditDebitIndicator?:
		| CreditDebitIndicator
		| CreditDebitIndicator[]
		| undefined;
	amountMin?: number | undefined;
	amountMax?: number | undefined;
}

// The joins every read of a user's transactions makes, so each row is read
// with the category the user sees: their override of that one transaction,
// else their remap of its category, else the category the consumer stored.

/** The user's override of this one transaction, if they set one */
export const transactionOverrideJoin = and(
	eq(userTransactionOverrides.transactionId, transactions.transactionId),
	eq(userTransactionOverrides.occurredAt, transactions.occurredAt),
	isNull(userTransactionOverrides.archivedAt)
);

/** The user's remap of the transaction's stored category, if they set one */
export const categoryOverrideJoin = and(
	eq(userCategoryOverrides.userId, transactions.userId),
	eq(userCategoryOverrides.fromCategoryId, transactions.categoryId),
	isNull(userCategoryOverrides.archivedAt)
);

export const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;

export const effectiveCategoryJoin = eq(
	categories.categoryId,
	effectiveCategoryId
);

/** One value with =, several with IN, and no condition when left out. */
function matchOneOrMany<Value>(
	column: PgColumn,
	value: Value | Value[] | undefined
) {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? inArray(column, value) : eq(column, value);
}

/**
 * The optional filters both reads share. Each caller puts them after its own
 * user and window conditions.
 */
export function buildFilterConditions(filter: TransactionFilter) {
	return [
		matchOneOrMany(transactions.accountId, filter.accountId),
		matchOneOrMany(transactions.transactionType, filter.transactionType),
		matchOneOrMany(
			transactions.creditDebitIndicator,
			filter.creditDebitIndicator
		),
		filter.amountMin === undefined
			? undefined
			: gte(transactions.amountMinor, filter.amountMin),
		filter.amountMax === undefined
			? undefined
			: lte(transactions.amountMinor, filter.amountMax),
		matchOneOrMany(categories.category, filter.category)
	];
}
