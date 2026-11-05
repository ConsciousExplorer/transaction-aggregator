import {
	describeTransactionCount,
	formatMoney,
	formatSignedMoney,
	formatWholeMoney
} from "./money.ts";
import { calculateAverageMinor, calculateShare } from "./ring.ts";

// The words of a spending row, on either tab: a category's row or a transaction type's

// A share that rounds to 0 while some money went out reads "<1%", so a small category does not
// look as if it spent nothing
function formatShare(moneyOutMinor: number, periodMoneyOutMinor: number) {
	const share = calculateShare(moneyOutMinor, periodMoneyOutMinor);
	if (share === 0) return "<1%";
	return `${share}%`;
}

// "6 transactions · 61%": the count, and the share of the period's money out. A row that sent
// no money has no share to give, so it reads its count alone.
export function describeRowSubline(
	count: number,
	moneyOutMinor: number,
	periodMoneyOutMinor: number
) {
	if (count === 0) return "nothing in this period";
	const countWords = describeTransactionCount(count);
	if (moneyOutMinor === 0) return countWords;
	return `${countWords} · ${formatShare(moneyOutMinor, periodMoneyOutMinor)}`;
}

// A row that received money and sent none, such as a category that only holds a salary
export function isMoneyInOnly(moneyOutMinor: number, moneyInMinor: number) {
	return moneyOutMinor === 0 && moneyInMinor > 0;
}

// A row's main amount is its money out. A row with only money in shows that instead, with its
// plus, since "R 0,00" would read as if the money never arrived.
export function describeRowAmount(
	moneyOutMinor: number,
	moneyInMinor: number,
	currency: string
) {
	if (isMoneyInOnly(moneyOutMinor, moneyInMinor)) {
		return formatSignedMoney({ amountMinor: moneyInMinor, currency }, "credit");
	}
	return formatMoney(moneyOutMinor, currency);
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
