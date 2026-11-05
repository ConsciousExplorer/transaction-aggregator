// The API caps a window at 366 days, so the longest period offered is 12 months
export const PERIOD_MONTHS = [1, 3, 12];

export function readPeriodMonths(value: string | null) {
	const months = Number(value);
	for (const option of PERIOD_MONTHS) {
		if (option === months) return option;
	}
	return 12;
}

// The period control's words: "1 month", "3 months"
export function describePeriod(months: number) {
	return months === 1 ? "1 month" : `${months} months`;
}

// The period in a sentence or a caption: "last month", "last 3 months", never "last 1 month"
export function describeLastPeriod(months: number) {
	return months === 1 ? "last month" : `last ${months} months`;
}

export function buildPeriod(months: number, now: Date) {
	const from = new Date(now);
	from.setUTCMonth(from.getUTCMonth() - months);
	return { fromDateTime: from.toISOString(), toDateTime: now.toISOString() };
}

export type Interval = "day" | "week" | "month";

// A chart reads best with about 4 to 31 bars, so each period offers the sizes that land there
export const INTERVALS_BY_PERIOD: Record<
	number,
	{ offered: Interval[]; initial: Interval }
> = {
	1: { offered: ["day", "week"], initial: "day" },
	3: { offered: ["week", "month"], initial: "week" },
	12: { offered: ["week", "month"], initial: "month" }
};

export function readInterval(value: string | null, months: number) {
	const choices = INTERVALS_BY_PERIOD[months];
	// Only the three periods above are offered; anything else reads like the 12-month default
	if (choices === undefined) return "month";
	for (const offered of choices.offered) {
		if (offered === value) return offered;
	}
	return choices.initial;
}
