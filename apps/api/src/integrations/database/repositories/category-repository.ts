import { eq } from "drizzle-orm";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import type { AppCradle } from "#src/container.ts";
import { categories } from "../schemas/schema.ts";

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
}
