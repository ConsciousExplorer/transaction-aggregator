import type { CreditDebitIndicator, Money } from "./types.ts";

// Amounts arrive in minor units (cents); en-ZA writes rand as "R 1 234,56"
export function formatMoney(amountMinor: number, currency: string) {
	const formatter = new Intl.NumberFormat("en-ZA", {
		style: "currency",
		currency
	});
	return formatter.format(amountMinor / 100);
}

// A transaction's amount is always positive; its direction says which way it went.
// U+2212 is the typographic minus, the width of the plus beside it.
export function formatSignedMoney(
	amount: Money,
	creditDebitIndicator: CreditDebitIndicator
) {
	const sign = creditDebitIndicator === "credit" ? "+" : "−";
	return `${sign}${formatMoney(amount.amountMinor, amount.currency)}`;
}
