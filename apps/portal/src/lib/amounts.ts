const RAND_PATTERN = /^\d+([.,]\d{1,2})?$/;

// An amount as a person types it in rand: digits with an optional comma or point and up to two
// decimals. Every whitespace character is removed, so a thousands separator typed as a space
// or a non-breaking space (the one en-ZA formatting writes) is accepted.
export function readRandAmount(value: string | null) {
	if (value === null) return undefined;
	const cleaned = value.replace(/\s/g, "");
	if (!RAND_PATTERN.test(cleaned)) return undefined;
	return cleaned;
}

// The API takes minor units (cents). Splitting the text avoids floating-point rounding.
export function convertRandToMinor(rand: string) {
	const [whole = "0", fraction = ""] = rand.replace(",", ".").split(".");
	return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
