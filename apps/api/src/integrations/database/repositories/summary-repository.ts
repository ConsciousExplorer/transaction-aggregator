import {
	and,
	count,
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
import type { PgColumn } from "drizzle-orm/pg-core";
import z from "zod";
import type { AppCradle } from "#src/container.ts";
import {
	creditDebitIndicatorSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";
import {
	transactions,
	userTransactionOverrides
} from "../schemas/partitioned.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export const userSummaryFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	accountId: z.union([z.uuid(), z.uuid().array()]).optional(),
	transactionType: z
		.union([transactionTypeSchema, transactionTypeSchema.array()])
		.optional(),
	category: z.union([z.string(), z.string().array()]).optional(),
	interval: z.enum(["day", "week", "month"]).optional(),
	creditDebitIndicator: z
		.union([creditDebitIndicatorSchema, creditDebitIndicatorSchema.array()])
		.optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional()
});

export type UserSummaryFilter = z.infer<typeof userSummaryFilter>;

// Bucket labels, not timestamps: "2026-08-15" | "2026-W33" | "2026-08".
// https://en.wikipedia.org/wiki/ISO_week_date
const BUCKET_FORMAT = {
	day: "YYYY-MM-DD",
	week: 'IYYY-"W"IW',
	month: "YYYY-MM"
} satisfies Record<NonNullable<UserSummaryFilter["interval"]>, string>;

export class SummaryRepository {
	readonly #db: NodePgDatabase;

	constructor({ db }: AppCradle) {
		this.#db = db;
	}

	async getUserSummary(filter: UserSummaryFilter) {
		// SQL
		const debitCount =
			sql<number>`count(*) filter (where ${transactions.creditDebitIndicator} = 'debit')`.mapWith(
				Number
			);
		const creditCount =
			sql<number>`count(*) filter (where ${transactions.creditDebitIndicator} = 'credit')`.mapWith(
				Number
			);
		// 1. Always use coalesce when counting or aggregating. The return is null and not 0
		// 2. In drizzle, use mapWith(Number) to cast the response as Number and not string
		const debitAmount =
			sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.creditDebitIndicator} = 'debit'), 0)`.mapWith(
				Number
			);
		const creditAmount =
			sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.creditDebitIndicator} = 'credit'), 0)`.mapWith(
				Number
			);
		const effectiveCategoryId = sql<number>`coalesce(${userTransactionOverrides.categoryId}, ${userCategoryOverrides.toCategoryId}, ${transactions.categoryId})`;
		const categoryValues =
			filter.category === undefined
				? undefined
				: Array.isArray(filter.category)
					? filter.category
					: [filter.category];

		const bucketStart = filter.interval
			? sql<string>`to_char(${transactions.occurredAt} at time zone 'UTC', ${sql.raw(`'${BUCKET_FORMAT[filter.interval]}'`)})`
			: sql<string>`${filter.fromDate}`;

		const conditions: (SQL | undefined)[] = [
			eq(transactions.userId, filter.userId),
			// Pending, reversed and failed rows stay visible on the list but never count as spend
			eq(transactions.status, "completed"),
			gte(transactions.occurredAt, filter.fromDate),
			lt(transactions.occurredAt, filter.toDate),
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

		const result = await this.#db
			.select({
				bucketStart,
				category: categories.category,
				currency: transactions.currency,
				count: count(transactions.transactionId),
				debitCount,
				creditCount,
				debitAmount,
				creditAmount
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
			.groupBy(...groupBy)
			.orderBy(...orderBy);

		return result;
	}
}
