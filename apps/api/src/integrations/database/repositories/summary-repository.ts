import {
	and,
	count,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	type SQL,
	sql,
	sum
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

export const userSummaryFilter = z.object({
	userId: z.string(),
	fromDate: z.iso.datetime(),
	toDate: z.iso.datetime(),
	source: z.union([sourceSchema, sourceSchema.array()]).optional(),
	category: z.union([z.string(), z.string().array()]).optional(),
	interval: z.enum(["day", "week", "month", "total"]).optional(),
	direction: z
		.union([z.enum(["debit", "credit"]), z.enum(["debit", "credit"]).array()])
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
	month: "YYYY-MM",
	total: undefined
} satisfies Record<
	NonNullable<UserSummaryFilter["interval"]>,
	string | undefined
>;

export class SummaryRepository {
	dbClient: NodePgClient;

	constructor({ database }: AppCradle) {
		this.dbClient = database;
	}

	async getUserSummary(filter: UserSummaryFilter) {
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
				: undefined
		];

		// SQL gotchas
		// 1. Always use coalesce when counting or aggregating. The return is null and not 0
		// 2. In drizzle, use mapWith(Number) to cast the response as Number and not string
		const result = await drizzle(this.dbClient)
			.select({
				bucketStart,
				category: categories.category,
				currency: transactions.currency,
				count: count(transactions.transactionId),
				netAmount: sum(transactions.amountMinor).mapWith(Number),
				debitCount:
					sql<number>`count(*) filter (where ${transactions.direction} = 'debit')`.mapWith(
						Number
					),
				creditCount:
					sql<number>`count(*) filter (where ${transactions.direction} = 'credit')`.mapWith(
						Number
					),
				debitAmount:
					sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.direction} = 'debit'), 0)`.mapWith(
						Number
					),
				creditAmount:
					sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.direction} = 'credit'), 0)`.mapWith(
						Number
					)
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
			.groupBy(
				...(filter.interval ? [bucketStart] : []),
				categories.category,
				transactions.currency
			)
			.orderBy(bucketStart, categories.category);

		return result;
	}
}
