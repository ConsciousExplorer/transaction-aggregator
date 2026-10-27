import { and, count, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { AppCradle } from "#src/container.ts";
import type {
	CreditDebitIndicator,
	SummaryInterval
} from "#src/schemas/transactions.ts";
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

/** GET .../summary: the filters, plus the bucket size */
export interface UserSummaryFilter extends TransactionFilter {
	interval?: SummaryInterval | undefined;
}

// Bucket labels, not timestamps: "2026-08-15" | "2026-W33" | "2026-08".
// https://en.wikipedia.org/wiki/ISO_week_date
const BUCKET_FORMAT = {
	day: "YYYY-MM-DD",
	week: 'IYYY-"W"IW',
	month: "YYYY-MM"
} satisfies Record<SummaryInterval, string>;

/**
 * The indicator goes into the SQL as a literal, not a parameter: it is one of
 * two fixed words. Postgres returns count and sum as bigint, which node-postgres
 * reads as a string, so mapWith(Number) turns the result back into a number.
 */
function countByIndicator(indicator: CreditDebitIndicator) {
	return sql<number>`count(*) filter (where ${transactions.creditDebitIndicator} = ${sql.raw(`'${indicator}'`)})`.mapWith(
		Number
	);
}

/** sum() over no rows is null, not 0, so it is coalesced */
function sumByIndicator(indicator: CreditDebitIndicator) {
	return sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.creditDebitIndicator} = ${sql.raw(`'${indicator}'`)}), 0)`.mapWith(
		Number
	);
}

export class SummaryRepository {
	readonly #database: NodePgDatabase;

	constructor({ database }: Pick<AppCradle, "database">) {
		this.#database = database;
	}

	async getUserSummary(filter: UserSummaryFilter) {
		const debitAmount = sumByIndicator("debit");

		const bucketStart = filter.interval
			? sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', ${sql.raw(`'${BUCKET_FORMAT[filter.interval]}'`)})`
			: sql<string>`${filter.fromDateTime}`;

		const conditions = [
			eq(transactions.userId, filter.userId),
			// Pending, reversed and failed rows stay visible on the list but never count as spend
			eq(transactions.status, "completed"),
			gte(transactions.occurredAt, filter.fromDateTime),
			lt(transactions.occurredAt, filter.toDateTime),
			...buildFilterConditions(filter)
		];

		// Without an interval the whole window is one bucket, so there is no
		// bucket to group or order by
		const groupBy: (SQL | PgColumn)[] = [];
		const orderBy: (SQL | PgColumn)[] = [];
		if (filter.interval) {
			groupBy.push(bucketStart);
			orderBy.push(bucketStart);
		}
		groupBy.push(categories.category, transactions.currency);
		orderBy.push(desc(debitAmount), categories.category);

		const rows = await this.#database
			.select({
				bucketStart,
				category: categories.category,
				currency: transactions.currency,
				count: count(transactions.transactionId),
				debitCount: countByIndicator("debit"),
				creditCount: countByIndicator("credit"),
				debitAmount,
				creditAmount: sumByIndicator("credit")
			})
			.from(transactions)
			.leftJoin(userTransactionOverrides, transactionOverrideJoin)
			.leftJoin(userCategoryOverrides, categoryOverrideJoin)
			.innerJoin(categories, effectiveCategoryJoin)
			.where(and(...conditions))
			.groupBy(...groupBy)
			.orderBy(...orderBy);

		return rows;
	}
}
