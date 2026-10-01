import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { linkWith, pageLinks, toKeysetPage } from "./paging.ts";

// Rows as a keyset query returns them, named by age: a is the newest
const NEWEST_FIRST = ["a", "b", "c"];

suite("toKeysetPage", () => {
	test("a full first page drops the look-ahead row and continues from its last row", () => {
		const page = toKeysetPage(NEWEST_FIRST, 2, "next", false);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			prevFrom: null
		});
	});

	test("a short page read downwards from a cursor is the last one", () => {
		const page = toKeysetPage(["b", "c"], 2, "next", true);
		assert.deepStrictEqual(page, {
			rows: ["b", "c"],
			nextFrom: null,
			prevFrom: "b"
		});
	});

	test("a full page read downwards from a cursor has both neighbours", () => {
		const page = toKeysetPage(NEWEST_FIRST, 2, "next", true);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			prevFrom: "a"
		});
	});

	test("a prev page is read oldest first, served newest first, and leaves the input alone", () => {
		const oldestFirst = ["c", "b", "a"];
		const page = toKeysetPage(oldestFirst, 2, "prev", true);
		assert.deepStrictEqual(page, {
			rows: ["b", "c"],
			nextFrom: "c",
			prevFrom: "b"
		});
		assert.deepStrictEqual(oldestFirst, ["c", "b", "a"]);
	});

	test("a short prev page is the newest one", () => {
		const page = toKeysetPage(["b", "a"], 2, "prev", true);
		assert.deepStrictEqual(page, {
			rows: ["a", "b"],
			nextFrom: "b",
			prevFrom: null
		});
	});

	test("an empty page has no neighbours", () => {
		const page = toKeysetPage([], 2, "next", true);
		assert.deepStrictEqual(page, { rows: [], nextFrom: null, prevFrom: null });
	});
});

suite("linkWith", () => {
	test("sets the given params and keeps the path and every other param as sent", () => {
		const link = linkWith("/api/v1/things?type=card&type=eft&cursor=old", {
			cursor: "new"
		});
		const url = new URL(link, "http://client.example");
		assert.strictEqual(url.pathname, "/api/v1/things");
		assert.deepStrictEqual(url.searchParams.getAll("type"), ["card", "eft"]);
		assert.deepStrictEqual(url.searchParams.getAll("cursor"), ["new"]);
	});

	test("adds a query to a request that had none", () => {
		assert.strictEqual(
			linkWith("/api/v1/things", { a: "1" }),
			"/api/v1/things?a=1"
		);
	});
});

suite("pageLinks", () => {
	const REQUEST = "/api/v1/things?toDateTime=2099-01-01T00:00:00.000Z&limit=2";
	const WINDOW = { toDateTime: "2026-10-01T12:00:00.000Z" };

	test("every link carries the window as read", () => {
		const links = pageLinks(REQUEST, WINDOW, { cursor: "b" }, { cursor: "a" });
		for (const link of [links.self, links.next, links.prev]) {
			const url = new URL(link ?? "", "http://client.example");
			assert.strictEqual(url.searchParams.get("toDateTime"), WINDOW.toDateTime);
			assert.strictEqual(url.searchParams.get("limit"), "2");
		}
		const next = new URL(links.next ?? "", "http://client.example");
		assert.strictEqual(next.searchParams.get("cursor"), "b");
	});

	test("next and prev are left out when there is no such page", () => {
		const links = pageLinks(REQUEST, WINDOW, null, null);
		assert.deepStrictEqual(Object.keys(links), ["self"]);
	});
});
