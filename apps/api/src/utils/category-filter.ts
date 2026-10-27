import { validationError } from "#src/errors/http-problem.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";

/**
 * Rejects a category filter that names a slug no category has. The read
 * would match nothing, and an empty answer reads the same as no spending.
 */
export async function assertKnownCategories(
	categoryRepository: Pick<CategoryRepository, "findUnknownCategories">,
	category: string | string[] | undefined
) {
	if (category === undefined) return;

	const slugs = Array.isArray(category) ? category : [category];
	const unknownSlugs = await categoryRepository.findUnknownCategories(slugs);
	if (unknownSlugs.length === 0) return;

	const issues = [];
	for (const slug of unknownSlugs) {
		issues.push({ path: ["category"], message: `unknown category ${slug}` });
	}
	throw validationError(issues);
}
