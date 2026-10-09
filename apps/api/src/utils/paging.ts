import type { ZodType } from "zod";
import { invalidCursorError } from "#src/errors/http-problem.ts";
import type { CursorDirection, Links } from "#src/schemas/common.ts";

export interface KeysetPage<Row> {
	/** At most limit rows, in sort order */
	rows: Row[];
	/** The row the next page continues from, or null when there is none */
	nextFrom: Row | null;
	/** The row the prev page continues from, or null when there is none */
	prevFrom: Row | null;
}

/**
 * One page from the rows a keyset query returned when read with limit + 1.
 * The extra row only proves that another page exists in the direction read.
 * A prev page is read against the sort order, so it is flipped back.
 */
export function toKeysetPage<Row>(
	fetched: Row[],
	limit: number,
	cursorDirection: CursorDirection,
	hasCursor: boolean
): KeysetPage<Row> {
	const hasMore = fetched.length > limit;
	const kept = hasMore ? fetched.slice(0, limit) : fetched;
	const rows = cursorDirection === "prev" ? kept.slice().reverse() : kept;

	// A next page exists when this page was read forwards and came back full,
	// or was read backwards from a cursor (the page it came from lies ahead).
	// A prev page is the mirror image.
	const hasNext = cursorDirection === "next" ? hasMore : hasCursor;
	const hasPrev = cursorDirection === "prev" ? hasMore : hasCursor;

	return {
		rows,
		nextFrom: hasNext ? (rows.at(-1) ?? null) : null,
		prevFrom: hasPrev ? (rows.at(0) ?? null) : null
	};
}

/**
 * A cursor as it travels in links: JSON, then base64url, so a client sees one
 * opaque query value and the cursor's shape is never part of the contract.
 */
export function encodeCursor(cursor: object): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/**
 * The cursor a client sent back, checked against its schema. Decoding
 * base64url never fails on its own (bad input decodes to garbage), so the JSON
 * parse and the schema are the checks. Either one failing is a 400.
 */
export function decodeCursor<Cursor>(text: string, schema: ZodType<Cursor>) {
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
 * ":" is left unencoded: it is legal in a query (RFC 3986 §3.4), and a client
 * that encodes a pasted link again would turn "%3A" into "%253A" and break
 * every datetime in it.
 */
export function buildLink(
	requestUrl: string,
	params: Record<string, string>
): string {
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
 * end. next and prev are left out when there is no such page.
 */
export function buildPageLinks(
	requestUrl: string,
	windowParams: Record<string, string>,
	nextParams: Record<string, string> | null,
	prevParams: Record<string, string> | null
): Links {
	const links: Links = { self: buildLink(requestUrl, windowParams) };
	if (nextParams) {
		links.next = buildLink(requestUrl, { ...windowParams, ...nextParams });
	}
	if (prevParams) {
		links.prev = buildLink(requestUrl, { ...windowParams, ...prevParams });
	}
	return links;
}
