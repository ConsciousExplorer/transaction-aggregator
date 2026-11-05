import assert from "node:assert/strict";
import { test } from "node:test";
import { convertRandToMinor, readRandAmount } from "./amounts.ts";

test("reads an amount the way a South African types it", () => {
	assert.equal(readRandAmount("250"), "250");
	assert.equal(readRandAmount("99,50"), "99,50");
	assert.equal(readRandAmount("1 000.5"), "1000.5");
	assert.equal(readRandAmount("1 000,50"), "1000,50");
	assert.equal(readRandAmount("abc"), undefined);
	assert.equal(readRandAmount("-5"), undefined);
	assert.equal(readRandAmount("1.234"), undefined);
	assert.equal(readRandAmount(""), undefined);
	assert.equal(readRandAmount(null), undefined);
});

test("converts rand to the API's minor units", () => {
	assert.equal(convertRandToMinor("100"), 10000);
	assert.equal(convertRandToMinor("99,5"), 9950);
	assert.equal(convertRandToMinor("0.07"), 7);
});
