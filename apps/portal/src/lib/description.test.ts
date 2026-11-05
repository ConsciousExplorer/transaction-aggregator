import assert from "node:assert/strict";
import { test } from "node:test";
import { splitLastWord } from "./description.ts";

test("a description of several words splits before its last word", () => {
	assert.deepEqual(splitLastWord("Money-market Account"), {
		leading: "Money-market ",
		lastWord: "Account"
	});
});

test("the words before the last keep their own spaces", () => {
	assert.deepEqual(splitLastWord("Mr. Duane Graves MD"), {
		leading: "Mr. Duane Graves ",
		lastWord: "MD"
	});
});

test("a description of one word is all last word", () => {
	assert.deepEqual(splitLastWord("Dis-Chem"), {
		leading: "",
		lastWord: "Dis-Chem"
	});
});

test("an empty description splits into two empty parts", () => {
	assert.deepEqual(splitLastWord(""), { leading: "", lastWord: "" });
});

test("a trailing space is dropped, so a description with words never ends in an empty one", () => {
	assert.deepEqual(splitLastWord("Pick n Pay "), {
		leading: "Pick n ",
		lastWord: "Pay"
	});
});
