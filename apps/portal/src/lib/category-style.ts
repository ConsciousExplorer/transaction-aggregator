import type { TransactionType } from "./types.ts";

// How a category looks: its hue and its icon. A category's colour is its identity, never its
// rank: a category keeps its hue whatever its place in a list or the ring, and whatever the
// period. One hue class colours it everywhere: the ring's segments, the badges on the spending
// rows and in the picker, and the table's dots.

export type CategoryHue =
	| "blue"
	| "orange"
	| "aqua"
	| "yellow"
	| "magenta"
	| "green"
	| "red"
	| "neutral"
	| "unknown";

export type IconName =
	| "transfers"
	| "car"
	| "cart"
	| "bank"
	| "bag"
	| "health"
	| "shield"
	| "ticket"
	| "repeat"
	| "dining"
	| "income"
	| "book"
	| "fitness"
	| "calendar"
	| "bolt"
	| "unknown"
	| "card"
	| "kebab"
	| "check"
	| "search"
	| "swap"
	| "reset"
	| "detail"
	| "sun"
	| "moon";

// Seven categories own a hue, and Uncategorised has a grey of its own, unknown. Every other
// slug, including one added to the categories table after this was written, is neutral. In
// light mode unknown is the darker of the two greys. In dark mode the two greys use dark
// values of their own, chosen so that the badge's icon, drawn in the grey, reaches 3:1 on its
// dark tint; with those values unknown is the lighter grey there. The seven hues keep the dark
// values set for them, which reach 3:1 as they are.
const CATEGORY_HUES: Record<string, CategoryHue> = {
	transfers: "blue",
	transport: "orange",
	groceries: "aqua",
	loan_repayment: "yellow",
	retail: "magenta",
	healthcare: "green",
	insurance: "red",
	uncategorised: "unknown"
};

// A category's icon. Uncategorised, and any slug added to the categories table after this
// was written, draws the question mark.
const CATEGORY_ICON_NAMES: Record<string, IconName> = {
	transfers: "transfers",
	transport: "car",
	groceries: "cart",
	loan_repayment: "bank",
	retail: "bag",
	healthcare: "health",
	insurance: "shield",
	entertainment: "ticket",
	subscriptions: "repeat",
	dining: "dining",
	income: "income",
	education: "book",
	fitness: "fitness",
	recurring_payments: "calendar",
	utilities: "bolt"
};

const TYPE_ICON_NAMES: Record<TransactionType, IconName> = {
	card: "card",
	eft: "bank",
	debit_order: "calendar",
	internal_transfer: "transfers"
};

// Reads only a map's own entries, so a slug named after a built-in object key such as
// "constructor" gets the fallback, not the value every object inherits
function readOwnEntry<Value>(
	entries: Record<string, Value>,
	key: string,
	fallback: Value
) {
	const value = Object.hasOwn(entries, key) ? entries[key] : undefined;
	return value ?? fallback;
}

export function readCategoryHue(slug: string) {
	return readOwnEntry(CATEGORY_HUES, slug, "neutral");
}

// The hue classes in tokens.css hand their colours on as --mark, --tint and --ink
export function buildHueClassName(hue: CategoryHue) {
	return `hue-${hue}`;
}

export function readCategoryIconName(slug: string) {
	return readOwnEntry(CATEGORY_ICON_NAMES, slug, "unknown");
}

export function readTypeIconName(transactionType: TransactionType) {
	return readOwnEntry(TYPE_ICON_NAMES, transactionType, "unknown");
}
