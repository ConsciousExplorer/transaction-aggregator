import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import type { AppCradle } from "#src/container.ts";
import { isForeignKeyViolation } from "../pool.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export class CategoryRepository {
	db: NodePgDatabase;

	constructor({ db }: AppCradle) {
		this.db = db;
	}

	async getCategories() {
		const result = await this.db
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label
			})
			.from(categories)
			.orderBy(categories.label, categories.categoryId);
		return result;
	}

	async resolveCategory(category: string) {
		const [result] = await this.db
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
		const toCategories = alias(categories, "to_categories");

		const result = await this.db
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label,
				toCategoryId: userCategoryOverrides.toCategoryId,
				toCategory: toCategories.category,
				toLabel: toCategories.label,
				createdAt: userCategoryOverrides.createdAt,
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
			.leftJoin(
				toCategories,
				eq(toCategories.categoryId, userCategoryOverrides.toCategoryId)
			)
			.orderBy(categories.label, categories.categoryId);

		return result;
	}

	async updateUserCategory(
		userId: string,
		fromCategoryId: number,
		toCategoryId: number
	) {
		try {
			const [override] = await this.db
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
			if (!override) return undefined;

			const toCategories = alias(categories, "to_categories");
			const [names] = await this.db
				.select({
					category: categories.category,
					label: categories.label,
					toCategory: toCategories.category,
					toLabel: toCategories.label
				})
				.from(categories)
				.innerJoin(toCategories, eq(toCategories.categoryId, toCategoryId))
				.where(eq(categories.categoryId, fromCategoryId));
			if (!names) return undefined;

			return { ...override, ...names };
		} catch (error) {
			if (isForeignKeyViolation(error)) return undefined;
			throw error;
		}
	}

	async archiveUserCategory(userId: string, fromCategoryId: number) {
		const [result] = await this.db
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
