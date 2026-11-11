import type { CursorDirection } from "#src/schemas/common.ts";

/**
 * One page from the rows a keyset query returned when read with limit + 1.
 * The extra row only proves that another page exists in the direction read.
 * A prev page is read against the sort order, so it is flipped back.
 *
 * Returns at most limit rows in sort order, plus the row the next page and the
 * prev page continue from: `nextFrom` and `previousFrom`, null when there is
 * none.
 */
export function buildKeysetPage<Row>(
	fetched: Row[],
	limit: number,
	cursorDirection: CursorDirection,
	hasCursor: boolean
) {
	const hasMore = fetched.length > limit;
	const kept = hasMore ? fetched.slice(0, limit) : fetched;
	const rows = cursorDirection === "prev" ? kept.slice().reverse() : kept;

	// A next page exists when this page was read forwards and came back full,
	// or was read backwards from a cursor (the page it came from lies ahead).
	// A prev page is the mirror image.
	const hasNext = cursorDirection === "next" ? hasMore : hasCursor;
	const hasPrevious = cursorDirection === "prev" ? hasMore : hasCursor;

	return {
		rows,
		nextFrom: hasNext ? (rows.at(-1) ?? null) : null,
		previousFrom: hasPrevious ? (rows.at(0) ?? null) : null
	};
}
