import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPeriod, readPeriodMonths } from "./periods.ts";

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
