import {
	and,
	eq,
	gte,
	inArray,
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
	direction: z
		.union([z.enum(["debit", "credit"]), z.enum(["debit", "credit"]).array()])
		.optional(),
	amountMin: z.number().int().optional(),
	amountMax: z.number().int().optional()
});

export type UserSummaryFilter = z.infer<typeof userSummaryFilter>;

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

		const result = await drizzle(this.dbClient)
			.select({
				category: categories.category,
				currency: transactions.currency,
				amount: sum(transactions.amountMinor)
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
			.groupBy(categories.category, transactions.currency);

		return result;
	}
}
