import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBarWidth } from "./bars.ts";

test("scales a value against the largest one", () => {
	assert.equal(calculateBarWidth(50, 200), 25);
	assert.equal(calculateBarWidth(200, 200), 100);
});

test("is zero when nothing was spent", () => {
	assert.equal(calculateBarWidth(0, 0), 0);
});
