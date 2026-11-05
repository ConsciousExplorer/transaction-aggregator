import assert from "node:assert/strict";
import { test } from "node:test";
import {
	chooseFocusIndex,
	chooseTabStopIndex,
	findFocusedIndex
} from "./menu-focus.ts";

// Three items, so the last index is 2
test("the arrows step and wrap, Home and End jump to the ends, and other keys move nothing", () => {
	const cases = [
		{ key: "ArrowDown", focusedIndex: 0, expected: 1 },
		{ key: "ArrowDown", focusedIndex: 2, expected: 0 },
		{ key: "ArrowUp", focusedIndex: 0, expected: 2 },
		{ key: "ArrowUp", focusedIndex: 2, expected: 1 },
		{ key: "ArrowDown", focusedIndex: -1, expected: 0 },
		{ key: "ArrowUp", focusedIndex: -1, expected: 2 },
		{ key: "Home", focusedIndex: 1, expected: 0 },
		{ key: "End", focusedIndex: 1, expected: 2 },
		{ key: "Enter", focusedIndex: 1, expected: undefined }
	];
	for (const focusCase of cases) {
		assert.equal(
			chooseFocusIndex(3, focusCase.focusedIndex, focusCase.key),
			focusCase.expected,
			`${focusCase.key} from ${focusCase.focusedIndex}`
		);
	}
});

test("an empty list moves focus nowhere, whatever the key", () => {
	for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
		assert.equal(chooseFocusIndex(0, -1, key), undefined, key);
	}
});

test("the Tab stop is the item focus was last on, else the current item, else the first", () => {
	const categoryIds = [4, 7, 9];
	assert.equal(chooseTabStopIndex(categoryIds, 9, 7), 2);
	assert.equal(chooseTabStopIndex(categoryIds, undefined, 7), 1);
	assert.equal(chooseTabStopIndex(categoryIds, undefined, undefined), 0);
});

test("a last-focused or current item a search left out of the list is passed over", () => {
	const categoryIds = [4, 7, 9];
	assert.equal(chooseTabStopIndex(categoryIds, 12, 9), 2);
	assert.equal(chooseTabStopIndex(categoryIds, 12, 15), 0);
});

test("finds the focused item's index, or -1 when focus is on none of them", () => {
	assert.equal(findFocusedIndex(["first", "second", "third"], "second"), 1);
	assert.equal(findFocusedIndex(["first", "second"], "elsewhere"), -1);
	assert.equal(findFocusedIndex(["first"], null), -1);
});
