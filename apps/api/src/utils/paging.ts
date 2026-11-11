import type { ZodType } from "zod";
import { invalidCursorError } from "#src/errors/http-problem.ts";
import type { Links } from "#src/schemas/common.ts";

/**
 * A cursor as it travels in links: JSON, then base64url, so a client sees one
 * opaque query value and the cursor's shape is never part of the contract.
 */
export function encodeCursor(cursor: object) {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * The cursor a client sent back, checked against its schema. Decoding
 * base64url never fails on its own (bad input decodes to garbage), so the JSON
 * parse and the schema are the checks. Either one failing is a 400.
 */
export function decodeCursor<Cursor>(
	text: string | undefined,
	schema: ZodType<Cursor>
) {
	// The first page is asked for without a cursor
	if (text === undefined) return undefined;

	let payload: unknown;
	try {
		payload = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
	} catch {
		throw invalidCursorError();
	}

	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		throw invalidCursorError();
	}
	return parsed.data;
}

/**
 * The request's own path and query with the given params set, so every other
 * filter carries over exactly as sent. Relative, so the API never has to know
 * the public host it is reached through.
 *
 * ":" is left unencoded: it is legal in a query string as it is, and a client
 * that encodes a pasted link again would turn "%3A" into "%253A" and break
 * every datetime in it.
 */
export function buildLink(requestUrl: string, params: Record<string, string>) {
	const queryStart = requestUrl.indexOf("?");
	const path = queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart);
	const query = new URLSearchParams(
		queryStart === -1 ? "" : requestUrl.slice(queryStart + 1)
	);

	for (const [name, value] of Object.entries(params)) {
		query.set(name, value);
	}

	return `${path}?${query.toString().replaceAll("%3A", ":")}`;
}

/**
 * self, next and prev for one page. Every link carries windowParams, the
 * values this page was read with, so a walk keeps one window from start to
 * end. next and prev carry the cursor of that page, and are left out when
 * there is no such page.
 */
export function buildPageLinks(
	requestUrl: string,
	windowParams: Record<string, string>,
	nextCursor: object | null,
	previousCursor: object | null
) {
	const links: Links = { self: buildLink(requestUrl, windowParams) };
	if (nextCursor) {
		links.next = buildLink(requestUrl, {
			...windowParams,
			cursor: encodeCursor(nextCursor)
		});
	}
	if (previousCursor) {
		links.prev = buildLink(requestUrl, {
			...windowParams,
			cursor: encodeCursor(previousCursor)
		});
	}
	return links;
}
