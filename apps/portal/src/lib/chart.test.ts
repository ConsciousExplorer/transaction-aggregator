import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSignedAxis, chooseAxisTicks } from "./chart.ts";

test("no maximum gives only the zero tick", () => {
	assert.deepEqual(chooseAxisTicks(0, 4), [0]);
	assert.deepEqual(chooseAxisTicks(-5, 4), [0]);
});

test("ticks run from zero in the smallest round step that fits the count", () => {
	assert.deepEqual(chooseAxisTicks(100, 4), [0, 25, 50, 75, 100]);
	assert.deepEqual(chooseAxisTicks(730, 4), [0, 200, 400, 600, 800]);
	assert.deepEqual(chooseAxisTicks(1234567, 2), [0, 1000000, 2000000]);
});

test("a signed axis with nothing on either side is just zero", () => {
	assert.deepEqual(buildSignedAxis(0, 0), {
		step: 1,
		top: 0,
		bottom: 0,
		ticks: [0]
	});
});

test("a signed axis shares one step and rounds each side up to it", () => {
	assert.deepEqual(buildSignedAxis(885729, 23606556), {
		step: 20000000,
		top: 20000000,
		bottom: -40000000,
		ticks: [-40000000, -20000000, 0, 20000000]
	});
});

test("a signed axis with equal sides is symmetric", () => {
	assert.deepEqual(buildSignedAxis(500, 500), {
		step: 250,
		top: 500,
		bottom: -500,
		ticks: [-500, -250, 0, 250, 500]
	});
});

test("a signed axis with nothing coming in has no ticks above zero", () => {
	assert.deepEqual(buildSignedAxis(0, 500), {
		step: 250,
		top: 0,
		bottom: -500,
		ticks: [-500, -250, 0]
	});
});
