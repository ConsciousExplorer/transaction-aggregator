import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { buildKeysetPage } from "./keyset-page.ts";

// Rows as a keyset query returns them, named by age: a is the newest
const NEWEST_FIRST = ["a", "b", "c"];

suite("buildKeysetPage", () => {
	test("a full first page drops the look-ahead row and continues from its last row", () => {
		const page = buildKeysetPage(NEWEST_FIRST, 2, "next", false);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			previousFrom: null
		});
	});

	test("a short page read downwards from a cursor is the last one", () => {
		const page = buildKeysetPage(["b", "c"], 2, "next", true);
		assert.deepStrictEqual(page, {
			rows: ["b", "c"],
			nextFrom: null,
			previousFrom: "b"
		});
	});

	test("a full page read downwards from a cursor has both neighbours", () => {
		const page = buildKeysetPage(NEWEST_FIRST, 2, "next", true);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			previousFrom: "a"
		});
	});

	test("a prev page is read oldest first, served newest first, and leaves the input alone", () => {
		const oldestFirst = ["c", "b", "a"];
		const page = buildKeysetPage(oldestFirst, 2, "prev", true);
		assert.deepStrictEqual(page, {
			rows: ["b", "c"],
			nextFrom: "c",
			previousFrom: "b"
		});
		assert.deepStrictEqual(oldestFirst, ["c", "b", "a"]);
	});

	test("a short prev page is the newest one", () => {
		const page = buildKeysetPage(["b", "a"], 2, "prev", true);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			previousFrom: null
		});
	});

	test("an empty page has no neighbours", () => {
		const page = buildKeysetPage([], 2, "next", true);
		assert.deepStrictEqual(page, {
			rows: [],
			nextFrom: null,
			previousFrom: null
		});
	});
});
