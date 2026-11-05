import { formatMoney } from "./money.ts";
import { describeLastPeriod } from "./periods.ts";
import type { Summary } from "./types.ts";

// The sentence under the title. The categories arrive ranked by money out, so the first one
// that spent anything is the one to name. The window's label carries its own preposition
// ("in the last 3 months", "in week 29, 13–19 Jul 2026", "on 14 Jul 2026"), since a day
// takes "on" where a span takes "in".
export function describeFinding(
	totals: Summary["totals"],
	rankedCategories: { label: string; moneyOutMinor: number }[],
	windowLabel: string
) {
	// The totals count completed transactions only; pending and failed ones are in the list
	if (totals.transactionCount === 0)
		return `No completed transactions ${windowLabel}.`;
	const moneyOutMinor = totals.debit.total.amountMinor;
	let top: { label: string; moneyOutMinor: number } | undefined;
	for (const category of rankedCategories) {
		if (category.moneyOutMinor > 0) {
			top = category;
			break;
		}
	}
	if (moneyOutMinor <= 0 || top === undefined)
		return `Nothing went out ${windowLabel}.`;
	const share = Math.round((top.moneyOutMinor / moneyOutMinor) * 100);
	const amount = formatMoney(top.moneyOutMinor, totals.debit.total.currency);
	return `${top.label} took ${amount}, ${share}% of what went out ${windowLabel}.`;
}

// The finding's window: the period, or the selected bucket's long name when one is picked
export function describeFindingWindow(
	months: number,
	bucketLabel: string | undefined,
	isDayBucket: boolean
) {
	if (bucketLabel === undefined) return `in the ${describeLastPeriod(months)}`;
	if (isDayBucket) return `on ${bucketLabel}`;
	// A week's long name starts a sentence with "Week"; mid-sentence it is "week"
	return `in ${bucketLabel.replace(/^Week/, "week")}`;
}
