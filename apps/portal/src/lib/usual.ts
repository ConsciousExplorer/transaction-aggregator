import { type CategoryFigures, readCategoryFigures } from "./categories.ts";
import { formatWholeMoney } from "./money.ts";

// Over a shorter period, a category's row says how far it ran over its usual month: its money
// out per month in the period against its money out per month over the last 12 months, both in
// whole cents. Only a rise of at least one rand is named; a category at or under its usual, or
// above it by less than a rand, says nothing.

// The usual month is measured over this many months, the longest period the screen offers
export const USUAL_WINDOW_MONTHS = 12;

// The line reads in whole rand, so a smaller rise would print as "+R 0", or round up to "+R 1"
const MINIMUM_DELTA_MINOR = 100;

// The 12-month period is the usual itself, and a selected bucket is not a run of months
export function isUsualShown(
	months: number,
	selectedBucket: string | undefined
) {
	return months < USUAL_WINDOW_MONTHS && selectedBucket === undefined;
}

// Each category whose money out in the period runs at least one rand a month above its usual
// month, by slug, with how far above in minor units. A category with no money out in the last
// 12 months has a usual of 0.
export function buildUsualDeltas(
	periodFigures: Record<string, CategoryFigures>,
	yearFigures: Record<string, CategoryFigures>,
	months: number
) {
	const deltas: Record<string, number> = {};
	for (const [slug, figures] of Object.entries(periodFigures)) {
		const monthlyMinor = Math.round(figures.moneyOutMinor / months);
		const usualMinor = Math.round(
			readCategoryFigures(yearFigures, slug).moneyOutMinor / USUAL_WINDOW_MONTHS
		);
		const deltaMinor = monthlyMinor - usualMinor;
		if (deltaMinor >= MINIMUM_DELTA_MINOR) deltas[slug] = deltaMinor;
	}
	return deltas;
}

// "+R 6 210 vs your usual month": whole rand, as the row's average reads, after an ASCII plus
export function describeUsualDelta(deltaMinor: number, currency: string) {
	return `+${formatWholeMoney(deltaMinor, currency)} vs your usual month`;
}
