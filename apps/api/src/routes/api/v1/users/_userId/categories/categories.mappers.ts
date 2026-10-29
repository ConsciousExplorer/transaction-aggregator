import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { UserCategory } from "./categories.schemas.ts";

type UserCategoryRow = Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
>[number];

export function buildUserCategoryResponse(row: UserCategoryRow) {
	const userCategory: UserCategory = {
		categoryId: row.categoryId,
		category: row.category,
		label: row.label
	};

	if (
		row.toCategoryId !== null &&
		row.toCategory !== null &&
		row.toLabel !== null &&
		row.updatedAt !== null
	) {
		userCategory.mappedTo = {
			categoryId: row.toCategoryId,
			category: row.toCategory,
			label: row.toLabel,
			updatedAt: new Date(row.updatedAt).toISOString()
		};
	}

	return userCategory;
}
