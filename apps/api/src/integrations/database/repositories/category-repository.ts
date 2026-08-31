import { eq } from "drizzle-orm";
import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";
import type { Queryable } from "../pool.ts";
import { categories } from "../schemas/schema.ts";

export async function getCategories(db: NodePgClient) {
	const result = await drizzle(db)
		.select({
			categoryId: categories.categoryId,
			category: categories.category,
			label: categories.label
		})
		.from(categories);
	return result;
}
export async function resolveCategory(db: Queryable, category: string) {
	const [result] = await drizzle(db)
		.select({
			categoryId: categories.categoryId,
			category: categories.category,
			label: categories.label
		})
		.from(categories)
		.where(eq(categories.category, category));
	return result;
}
