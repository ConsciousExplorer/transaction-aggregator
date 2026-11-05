import type { Category } from "./types.ts";

// The categories whose label holds the search, ignoring case and the spaces around it, in
// their given order and less the excluded one. An empty search matches every label.
export function filterCategories(
	categories: Category[],
	search: string,
	excludedCategoryId: number | undefined
) {
	const normalisedSearch = search.trim().toLowerCase();
	const matches: Category[] = [];
	for (const category of categories) {
		if (category.categoryId === excludedCategoryId) continue;
		if (category.label.toLowerCase().includes(normalisedSearch))
			matches.push(category);
	}
	return matches;
}
