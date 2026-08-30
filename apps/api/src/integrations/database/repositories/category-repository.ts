import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Queryable } from "../pool.ts";
import { categories } from "../schemas/schema.ts";

export async function getCategories(db: Queryable) {
	const result = await drizzle(db).select().from(categories);
	return result;
}
export async function resolveCategoryId(
	db: Queryable,
	category: string
): Promise<number | null> {
	const [row] = await drizzle(db)
		.select({ categoryId: categories.categoryId })
		.from(categories)
		.where(eq(categories.category, category));
	return row?.categoryId ?? null;
}
