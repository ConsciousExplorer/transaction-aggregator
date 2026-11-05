import type { Category, SummaryRow } from "./types.ts";

export type CategoryFigures = {
	moneyInMinor: number;
	moneyOutMinor: number;
	// Every transaction in the category, money in and out alike
	count: number;
	// Only those that sent money out, which an average of money out divides by
	moneyOutCount: number;
};

// The summary grouped by category has a row per category; key them by slug for lookup
export function buildCategoryFigures(rows: SummaryRow[]) {
	const figures: Record<string, CategoryFigures> = {};
	for (const row of rows) {
		const category = row.group.category;
		if (category === undefined) continue;
		figures[category] = {
			moneyInMinor: row.credit.total.amountMinor,
			moneyOutMinor: row.debit.total.amountMinor,
			count: row.count,
			moneyOutCount: row.debit.count
		};
	}
	return figures;
}

// A category with no transactions in the period has no summary row
export function readCategoryFigures(
	figures: Record<string, CategoryFigures>,
	category: string
) {
	return (
		figures[category] ?? {
			moneyInMinor: 0,
			moneyOutMinor: 0,
			count: 0,
			moneyOutCount: 0
		}
	);
}

// Most money out first, then most money in, then by name
export function orderCategories(
	categories: Category[],
	figures: Record<string, CategoryFigures>
) {
	const ordered = [...categories];
	ordered.sort((first, second) => {
		const firstFigures = readCategoryFigures(figures, first.category);
		const secondFigures = readCategoryFigures(figures, second.category);
		if (firstFigures.moneyOutMinor !== secondFigures.moneyOutMinor)
			return secondFigures.moneyOutMinor - firstFigures.moneyOutMinor;
		if (firstFigures.moneyInMinor !== secondFigures.moneyInMinor)
			return secondFigures.moneyInMinor - firstFigures.moneyInMinor;
		return first.label.localeCompare(second.label);
	});
	return ordered;
}

// A category earns a row by having transactions in the period. Two stay without any: a
// remapped category, whose transactions all count under the category it is shown as and whose
// menu is the only way to remove the remap, and the selected category, so the selection stays
// in view.
function isCategoryShown(
	category: Category,
	figures: Record<string, CategoryFigures>,
	selectedCategory: string | undefined
) {
	if (readCategoryFigures(figures, category.category).count > 0) return true;
	if (category.mappedTo !== undefined) return true;
	return category.category === selectedCategory;
}

// The ranked categories that get a row, in their ranked order
export function listShownCategories(
	ranked: Category[],
	figures: Record<string, CategoryFigures>,
	selectedCategory: string | undefined
) {
	const shown = [];
	for (const category of ranked) {
		if (isCategoryShown(category, figures, selectedCategory)) {
			shown.push(category);
		}
	}
	return shown;
}
