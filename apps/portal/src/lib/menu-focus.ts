// Moving focus through a list of items with the keys a menu or a listbox answers

// The index a key moves focus to: the arrows step down and up, wrapping at the ends, and Home
// and End jump to them. A focused index of -1 means focus is on none of the items, so the
// arrows start from an end. Any other key, or an empty list, moves nothing.
export function chooseFocusIndex(
	itemCount: number,
	focusedIndex: number,
	key: string
) {
	if (itemCount === 0) return undefined;
	const lastIndex = itemCount - 1;
	if (key === "Home") return 0;
	if (key === "End") return lastIndex;
	if (key === "ArrowDown")
		return focusedIndex >= lastIndex ? 0 : focusedIndex + 1;
	if (key === "ArrowUp")
		return focusedIndex <= 0 ? lastIndex : focusedIndex - 1;
	return undefined;
}

// A list with one Tab stop among its items, which the arrow keys move: the stop is the item
// focus was last on, else the current item, else the first. An item no longer in the list,
// such as one a search left out, is passed over.
export function chooseTabStopIndex(
	items: readonly unknown[],
	lastFocusedItem: unknown,
	currentItem: unknown
) {
	const lastFocusedIndex = items.indexOf(lastFocusedItem);
	if (lastFocusedIndex !== -1) return lastFocusedIndex;
	const currentIndex = items.indexOf(currentItem);
	if (currentIndex !== -1) return currentIndex;
	return 0;
}

// Where the focused element sits among the items, or -1 when it is none of them
export function findFocusedIndex(
	items: readonly unknown[],
	focusedElement: unknown
) {
	for (const [index, item] of items.entries()) {
		if (item === focusedElement) return index;
	}
	return -1;
}
