import { describeTransactionCount, formatWholeMoney } from "./money.ts";
import { calculateAverageMinor, calculateShare } from "./ring.ts";

// The words of a spending row, on either tab: a category's row or a transaction type's

// A share that rounds to 0 while some money went out reads "<1%", so a small category does not
// look as if it spent nothing; only a row with no money out reads "0%"
function formatShare(moneyOutMinor: number, periodMoneyOutMinor: number) {
	const share = calculateShare(moneyOutMinor, periodMoneyOutMinor);
	if (share === 0 && moneyOutMinor > 0) return "<1%";
	return `${share}%`;
}

// "6 transactions · 61%": the count, and the share of the period's money out
export function describeRowSubline(
	count: number,
	moneyOutMinor: number,
	periodMoneyOutMinor: number
) {
	if (count === 0) return "nothing in this period";
	const share = formatShare(moneyOutMinor, periodMoneyOutMinor);
	return `${describeTransactionCount(count)} · ${share}`;
}

// "R 24 170 avg": money out per transaction that sent money out, in whole rand. A row with
// nothing out, such as a category that only received money, has no average.
export function describeRowAverage(
	moneyOutMinor: number,
	moneyOutCount: number,
	currency: string
) {
	const averageMinor = calculateAverageMinor(moneyOutMinor, moneyOutCount);
	if (averageMinor === undefined) return undefined;
	return `${formatWholeMoney(averageMinor, currency)} avg`;
}
