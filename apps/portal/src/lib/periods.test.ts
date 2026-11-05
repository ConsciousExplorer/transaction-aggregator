import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildPeriod,
	describeLastPeriod,
	describePeriod,
	INTERVALS_BY_PERIOD,
	readInterval,
	readPeriodMonths
} from "./periods.ts";

test("builds a window ending now and starting the given months back", () => {
	const period = buildPeriod(3, new Date("2026-10-18T10:00:00.000Z"));
	assert.deepEqual(period, {
		fromDateTime: "2026-07-18T10:00:00.000Z",
		toDateTime: "2026-10-18T10:00:00.000Z"
	});
});

test("reads a supported period and falls back to 12 months", () => {
	assert.equal(readPeriodMonths("3"), 3);
	assert.equal(readPeriodMonths("7"), 12);
	assert.equal(readPeriodMonths(null), 12);
});

test("offers the intervals that read as a chart for the period", () => {
	assert.deepEqual(INTERVALS_BY_PERIOD[1], {
		offered: ["day", "week"],
		initial: "day"
	});
	assert.deepEqual(INTERVALS_BY_PERIOD[12], {
		offered: ["week", "month"],
		initial: "month"
	});
});

test("an interval the period does not offer falls back to its default", () => {
	assert.equal(readInterval("week", 12), "week");
	assert.equal(readInterval("day", 12), "month");
	assert.equal(readInterval(null, 3), "week");
	assert.equal(readInterval("hour", 1), "day");
});

test("describes a period in months, singular for one", () => {
	assert.equal(describePeriod(1), "1 month");
	assert.equal(describePeriod(12), "12 months");
});

test("names the period in a sentence as the last month or the last few months", () => {
	assert.equal(describeLastPeriod(1), "last month");
	assert.equal(describeLastPeriod(3), "last 3 months");
	assert.equal(describeLastPeriod(12), "last 12 months");
});
