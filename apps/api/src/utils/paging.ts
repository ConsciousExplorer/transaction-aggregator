import type { Links } from "#src/schemas/common.ts";

// next reads older rows than the cursor, prev reads newer ones
export type CursorDirection = "next" | "prev";

export interface KeysetPage<Row> {
	/** At most limit rows, newest first */
	rows: Row[];
	/** The row the next (older) page continues from, or null when there is none */
	nextFrom: Row | null;
	/** The row the prev (newer) page continues from, or null when there is none */
	prevFrom: Row | null;
}

/**
 * One page from the rows a keyset query returned when read with limit + 1.
 * The extra row only proves that another page exists in the direction read.
 * A prev page is read oldest first, so it is flipped to be served newest first.
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

	// Older rows exist when the page was read downwards and came back full,
	// or was read upwards from a cursor (the page it came from is older).
	// Newer rows are the mirror image.
	const hasOlder = cursorDirection === "next" ? hasMore : hasCursor;
	const hasNewer = cursorDirection === "prev" ? hasMore : hasCursor;

	return {
		rows,
		nextFrom: hasOlder ? (rows.at(-1) ?? null) : null,
		prevFrom: hasNewer ? (rows.at(0) ?? null) : null
	};
}

/**
 * The request's own path and query with the given params set, so every other
 * filter carries over exactly as sent. Relative, so the API never has to know
 * the public host it is reached through.
 */
export function linkWith(
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

	return `${path}?${query.toString()}`;
}

/**
 * self, next and prev for one page. Every link carries windowParams, the
 * values this page was read with, so a walk keeps one window from start to
 * end. next and prev are left out when there is no such page.
 */
export function pageLinks(
	requestUrl: string,
	windowParams: Record<string, string>,
	nextParams: Record<string, string> | null,
	prevParams: Record<string, string> | null
): Links {
	const links: Links = { self: linkWith(requestUrl, windowParams) };
	if (nextParams) {
		links.next = linkWith(requestUrl, { ...windowParams, ...nextParams });
	}
	if (prevParams) {
		links.prev = linkWith(requestUrl, { ...windowParams, ...prevParams });
	}
	return links;
}
