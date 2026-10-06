import { windowTooLargeError } from "#src/errors/http-problem.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rejects a date range wider than maxDays. toDateTime is exclusive. */
export function assertWindowWithin(
	fromDateTime: string,
	toDateTime: string,
	maxDays: number
): void {
	const spanMs = Date.parse(toDateTime) - Date.parse(fromDateTime);
	if (spanMs > maxDays * DAY_MS) throw windowTooLargeError(maxDays);
}
