import { and, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import type { AppCradle } from "#src/container.ts";
import { isForeignKeyViolation } from "../pool.ts";
import { categories, userCategoryOverrides } from "../schemas/schema.ts";

export class CategoryRepository {
	readonly #database: NodePgDatabase;

	constructor({ database }: Pick<AppCradle, "database">) {
		this.#database = database;
	}

	async getCategories() {
		const result = await this.#database
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label
			})
			.from(categories)
			.orderBy(categories.label, categories.categoryId);
		return result;
	}

	/** The slugs, of those given, that no category has */
	async findUnknownCategories(slugs: string[]) {
		const rows = await this.#database
			.select({ category: categories.category })
			.from(categories)
			.where(inArray(categories.category, slugs));

		const knownSlugs = new Set<string>();
		for (const row of rows) {
			knownSlugs.add(row.category);
		}

		const unknownSlugs: string[] = [];
		for (const slug of slugs) {
			if (!knownSlugs.has(slug)) unknownSlugs.push(slug);
		}
		return unknownSlugs;
	}

	async getUserCategories(userId: string) {
		const toCategories = alias(categories, "to_categories");

		const result = await this.#database
			.select({
				categoryId: categories.categoryId,
				category: categories.category,
				label: categories.label,
				toCategoryId: userCategoryOverrides.toCategoryId,
				toCategory: toCategories.category,
				toLabel: toCategories.label,
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
			const [override] = await this.#database
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
				// An insert writes created_at and updated_at from the same now();
				// the conflict branch writes updated_at alone. (xmax = 0) would be
				// exact, but Postgres refuses system columns in RETURNING on a
				// partitioned table.
				.returning({
					...getTableColumns(userCategoryOverrides),
					inserted: sql<boolean>`(created_at = updated_at)`
				});
			if (!override) return undefined;

			const toCategories = alias(categories, "to_categories");
			const [names] = await this.#database
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
		await this.#database
			.update(userCategoryOverrides)
			.set({ archivedAt: sql`now()` })
			.where(
				and(
					eq(userCategoryOverrides.userId, userId),
					eq(userCategoryOverrides.fromCategoryId, fromCategoryId),
					isNull(userCategoryOverrides.archivedAt)
				)
			);
	}
}
