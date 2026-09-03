import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import type { AppCradle } from "#src/container.ts";
import { isForeignKeyViolation } from "../pool.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export class CategoryRepository {
	dbClient: NodePgClient;

	constructor({ database }: AppCradle) {
		this.dbClient = database;
	}

	async getCategories() {
		const result = await drizzle(this.dbClient)
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label
			})
			.from(categories);
		return result;
	}

	async resolveCategory(category: string) {
		const [result] = await drizzle(this.dbClient)
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label
			})
			.from(categories)
			.where(eq(categories.category, category));
		return result;
	}

	async getUserCategories(userId: string) {
		const result = await drizzle(this.dbClient)
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label,
				toCategoryId: userCategoryOverrides.toCategoryId,
				updatedAt: userCategoryOverrides.updatedAt
			})
			.from(categories)
			.leftJoin(
				userCategoryOverrides,
				and(
					eq(userCategoryOverrides.fromCategoryId, categories.categoryId),
					eq(userCategoryOverrides.userId, userId),
					isNull(userCategoryOverrides.archivedAt)
				)
			)
			.orderBy(categories.categoryId);

		return result;
	}

	async updateUserCategory(
		userId: string,
		fromCategoryId: number,
		toCategoryId: number
	) {
		try {
			const [result] = await drizzle(this.dbClient)
				.insert(userCategoryOverrides)
				.values({ userId, fromCategoryId, toCategoryId })
				.onConflictDoUpdate({
					target: [
						userCategoryOverrides.userId,
						userCategoryOverrides.fromCategoryId
					],
					set: {
						toCategoryId,
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

	async archiveUserCategory(userId: string, fromCategoryId: number) {
		const [result] = await drizzle(this.dbClient)
			.update(userCategoryOverrides)
			.set({ archivedAt: sql`now()` })
			.where(
				and(
					eq(userCategoryOverrides.userId, userId),
					eq(userCategoryOverrides.fromCategoryId, fromCategoryId),
					isNull(userCategoryOverrides.archivedAt)
				)
			)
			.returning();

		return result;
	}
}
