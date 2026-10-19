// The API caps a window at 366 days, so the longest period offered is 12 months
export const PERIOD_MONTHS = [1, 3, 12];

export function readPeriodMonths(value: string | null) {
	const months = Number(value);
	for (const option of PERIOD_MONTHS) {
		if (option === months) return option;
	}
	return 12;
}

export function buildPeriod(months: number, now: Date) {
	const from = new Date(now);
	from.setUTCMonth(from.getUTCMonth() - months);
	return { fromDateTime: from.toISOString(), toDateTime: now.toISOString() };
}
