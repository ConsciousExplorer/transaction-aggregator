import type { CreditDebitIndicator, Money } from "./types.ts";

// Amounts arrive in minor units (cents); en-ZA writes rand as "R 1 234,56"
export function formatMoney(amountMinor: number, currency: string) {
	const formatter = new Intl.NumberFormat("en-ZA", {
		style: "currency",
		currency
	});
	return formatter.format(amountMinor / 100);
}

// An average reads as whole rand, "R 24 170": its cents are noise, not information
export function formatWholeMoney(amountMinor: number, currency: string) {
	const formatter = new Intl.NumberFormat("en-ZA", {
		style: "currency",
		currency,
		maximumFractionDigits: 0
	});
	return formatter.format(amountMinor / 100);
}

// The ring's total splits at the decimal comma, so the rand can stand in ink and the cents
// smaller and grey: "R 236 065" and ",56". Formatted money with no comma is all rand.
export function splitAtCents(formatted: string) {
	const commaIndex = formatted.lastIndexOf(",");
	if (commaIndex === -1) return { whole: formatted, cents: "" };
	return {
		whole: formatted.slice(0, commaIndex),
		cents: formatted.slice(commaIndex)
	};
}

// An axis label is whole rand, since its ticks are round numbers. U+2212 is the typographic
// minus, as in the signed amounts.
export function formatAxisMoney(amountMinor: number) {
	const formatted = formatWholeMoney(Math.abs(amountMinor), "ZAR");
	return amountMinor < 0 ? `−${formatted}` : formatted;
}

// A phone's axis gutter is too narrow for "−R 1 000 000", so its labels count in thousands
// ("R 400 k") or millions to one decimal ("−R 1,0 m"). Below a thousand the rand are whole.
export function formatAxisMoneyCompact(amountMinor: number) {
	const rand = Math.abs(amountMinor) / 100;
	let formatted: string;
	if (rand >= 1000000) {
		const formatter = new Intl.NumberFormat("en-ZA", {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		});
		formatted = `R\u00a0${formatter.format(rand / 1000000)}\u00a0m`;
	} else if (rand >= 1000) {
		const formatter = new Intl.NumberFormat("en-ZA", {
			maximumFractionDigits: 1
		});
		formatted = `R\u00a0${formatter.format(rand / 1000)}\u00a0k`;
	} else {
		formatted = formatAxisMoney(rand * 100);
	}
	return amountMinor < 0 ? `−${formatted}` : formatted;
}

// A count takes the same en-ZA grouping as the amounts beside it: "12 345"
export function formatCount(count: number) {
	const formatter = new Intl.NumberFormat("en-ZA");
	return formatter.format(count);
}

// A grouped count with its noun, singular for one: "1 transaction", "12 345 transactions"
export function describeTransactionCount(count: number) {
	const noun = count === 1 ? "transaction" : "transactions";
	return `${formatCount(count)} ${noun}`;
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

// The net has no direction field of its own: a minus when more went out, a plus when more came
// in, no sign at zero
export function formatNetAmount(net: Money) {
	if (net.amountMinor === 0) return formatMoney(0, net.currency);
	const direction = net.amountMinor < 0 ? "debit" : "credit";
	return formatSignedMoney(
		{ amountMinor: Math.abs(net.amountMinor), currency: net.currency },
		direction
	);
}
