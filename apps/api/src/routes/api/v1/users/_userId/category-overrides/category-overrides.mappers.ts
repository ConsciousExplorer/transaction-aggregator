import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";

type CategoryOverrideRow = NonNullable<
	Awaited<ReturnType<CategoryRepository["updateUserCategory"]>>
>;

/** The just-written category with its new mappedTo, as GET "" shows it */
export function buildRemappedUserCategory(override: CategoryOverrideRow) {
	return {
		categoryId: override.fromCategoryId,
		category: override.category,
		label: override.label,
		mappedTo: {
			categoryId: override.toCategoryId,
			category: override.toCategory,
			label: override.toLabel,
			updatedAt: new Date(override.updatedAt).toISOString()
		}
	};
}
