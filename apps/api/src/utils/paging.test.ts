import assert from "node:assert/strict";
import { suite, test } from "node:test";
import z from "zod";
import { invalidCursorError } from "#src/errors/http-problem.ts";
import {
	buildLink,
	buildPageLinks,
	decodeCursor,
	encodeCursor
} from "./paging.ts";

suite("encodeCursor and decodeCursor", () => {
	const positionSchema = z.object({ at: z.string(), id: z.number() });
	const INVALID_CURSOR = { payload: invalidCursorError().payload };

	test("a cursor decodes back to what was encoded, as URL-safe text", () => {
		const text = encodeCursor({ at: "2026-10-01T00:00:00.000000Z", id: 7 });
		assert.match(text, /^[A-Za-z0-9_-]+$/);
		assert.deepStrictEqual(decodeCursor(text, positionSchema), {
			at: "2026-10-01T00:00:00.000000Z",
			id: 7
		});
	});

	test("text that isn't base64url JSON is an invalid cursor", () => {
		assert.throws(
			() => decodeCursor("not-a-cursor", positionSchema),
			INVALID_CURSOR
		);
		assert.throws(() => decodeCursor("", positionSchema), INVALID_CURSOR);
	});

	test("no cursor decodes to none, which asks for the first page", () => {
		assert.strictEqual(decodeCursor(undefined, positionSchema), undefined);
	});

	test("JSON that doesn't match the schema is an invalid cursor", () => {
		const text = encodeCursor({ at: "2026-10-01T00:00:00.000000Z", id: "7" });
		assert.throws(() => decodeCursor(text, positionSchema), INVALID_CURSOR);
	});
});

suite("buildLink", () => {
	test("sets the given params and keeps the path and every other param as sent", () => {
		const link = buildLink("/api/v1/things?type=card&type=eft&cursor=old", {
			cursor: "new"
		});
		const url = new URL(link, "http://client.example");
		assert.strictEqual(url.pathname, "/api/v1/things");
		assert.deepStrictEqual(url.searchParams.getAll("type"), ["card", "eft"]);
		assert.deepStrictEqual(url.searchParams.getAll("cursor"), ["new"]);
	});

	test("adds a query to a request that had none", () => {
		assert.strictEqual(
			buildLink("/api/v1/things", { a: "1" }),
			"/api/v1/things?a=1"
		);
	});

	test("datetime values keep ':' unencoded, however the request sent them", () => {
		const link = buildLink(
			"/api/v1/things?fromDateTime=2025-12-01T00%3A00%3A00Z",
			{
				toDateTime: "2025-12-30T13:33:01.634000Z"
			}
		);
		// Nothing left for a client that encodes the link again to double-encode
		assert.strictEqual(
			link,
			"/api/v1/things?fromDateTime=2025-12-01T00:00:00Z&toDateTime=2025-12-30T13:33:01.634000Z"
		);
	});

	test("a value with query delimiters in it is still encoded", () => {
		const link = buildLink("/api/v1/things", { q: "a&b=c d" });
		const url = new URL(link, "http://client.example");
		assert.strictEqual(url.searchParams.get("q"), "a&b=c d");
		assert.deepStrictEqual([...url.searchParams.keys()], ["q"]);
	});
});

suite("buildPageLinks", () => {
	const REQUEST = "/api/v1/things?toDateTime=2099-01-01T00:00:00.000Z&limit=2";
	const WINDOW = { toDateTime: "2026-10-01T12:00:00.000Z" };
	const NEXT_CURSOR = { direction: "next", position: { id: 7 } };
	const PREVIOUS_CURSOR = { direction: "prev", position: { id: 3 } };

	test("every link carries the window as read", () => {
		const links = buildPageLinks(REQUEST, WINDOW, NEXT_CURSOR, PREVIOUS_CURSOR);
		for (const link of [links.self, links.next, links.prev]) {
			const url = new URL(link ?? "", "http://client.example");
			assert.strictEqual(url.searchParams.get("toDateTime"), WINDOW.toDateTime);
			assert.strictEqual(url.searchParams.get("limit"), "2");
		}
	});

	test("next and prev each carry their page's cursor, encoded", () => {
		const links = buildPageLinks(REQUEST, WINDOW, NEXT_CURSOR, PREVIOUS_CURSOR);
		const next = new URL(links.next ?? "", "http://client.example");
		const previous = new URL(links.prev ?? "", "http://client.example");
		assert.strictEqual(
			next.searchParams.get("cursor"),
			encodeCursor(NEXT_CURSOR)
		);
		assert.strictEqual(
			previous.searchParams.get("cursor"),
			encodeCursor(PREVIOUS_CURSOR)
		);
	});

	test("next and prev are left out when there is no such page", () => {
		const links = buildPageLinks(REQUEST, WINDOW, null, null);
		assert.deepStrictEqual(Object.keys(links), ["self"]);
	});
});
