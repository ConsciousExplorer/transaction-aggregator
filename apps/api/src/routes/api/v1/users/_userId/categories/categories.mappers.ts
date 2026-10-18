import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";

type UserCategoryRow = Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
>[number];

export function buildUserCategoryResponse(row: UserCategoryRow) {
	return {
		id: row.categoryId,
		category: row.category,
		label: row.label,
		...(row.toCategoryId !== null &&
		row.toCategory !== null &&
		row.toLabel !== null &&
		row.updatedAt !== null
			? {
					mappedTo: {
						id: row.toCategoryId,
						category: row.toCategory,
						label: row.toLabel,
						updatedAt: new Date(row.updatedAt).toISOString()
					}
				}
			: {})
	};
}
