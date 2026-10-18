import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";

type CategoryRow = Awaited<
	ReturnType<CategoryRepository["getCategories"]>
>[number];

export function buildCategoryResponse(row: CategoryRow) {
	return {
		categoryId: row.categoryId,
		category: row.category,
		label: row.label
	};
}
