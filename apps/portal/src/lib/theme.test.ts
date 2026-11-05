import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildThemeCookie,
	chooseOppositeTheme,
	readThemeChoice
} from "./theme.ts";

test("the cookie's two names are a choice", () => {
	assert.equal(readThemeChoice("light"), "light");
	assert.equal(readThemeChoice("dark"), "dark");
});

test("no cookie, or anything but the two names, is no choice", () => {
	assert.equal(readThemeChoice(undefined), undefined);
	assert.equal(readThemeChoice(""), undefined);
	assert.equal(readThemeChoice('dark"><script>'), undefined);
});

test("with no choice the toggle offers the opposite of the system's mode", () => {
	assert.equal(chooseOppositeTheme(undefined, false), "dark");
	assert.equal(chooseOppositeTheme(undefined, true), "light");
});

test("with a choice the toggle offers its opposite, whatever the system's mode", () => {
	assert.equal(chooseOppositeTheme("light", true), "dark");
	assert.equal(chooseOppositeTheme("light", false), "dark");
	assert.equal(chooseOppositeTheme("dark", true), "light");
	assert.equal(chooseOppositeTheme("dark", false), "light");
});

test("the cookie lasts a year across the whole portal", () => {
	assert.equal(
		buildThemeCookie("dark"),
		"portal_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax"
	);
});
