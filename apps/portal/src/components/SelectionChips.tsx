import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";
import type { SelectionChip } from "@/lib/selections.ts";

// The ledger block's heading, which takes focus when no list is left to take it. The block
// writes the id and this component focuses it, so both read it from here.
export const LEDGER_HEADING_ID = "ledger-heading";

function buildChipItems(chips: SelectionChip[]) {
	const items: ReactNode[] = [];
	for (const chip of chips) {
		items.push(
			<li key={chip.name}>
				<Link
					className="selection-chip"
					href={chip.href}
					replace
					scroll={false}
					aria-label={`Remove ${chip.label}`}
				>
					{chip.label}
					<span aria-hidden="true">×</span>
				</Link>
			</li>
		);
	}
	return items;
}

// The bucket and category picked on the chart and the column, each a chip whose link removes
// it, then "Clear all" while any filter is set. A removed chip takes its focus with it, so
// when focus has fallen back to the page, it moves to the list without scrolling; when the
// last one goes and the list with it, focus moves to the ledger's heading. A chip that goes
// because a bar or a period was picked elsewhere leaves focus where it is.
export function SelectionChips({
	chips,
	clearAllHref,
	hasFilters
}: {
	chips: SelectionChip[];
	clearAllHref: string;
	hasFilters: boolean;
}) {
	const listRef = useRef<HTMLUListElement>(null);
	const previousCountRef = useRef(chips.length);
	const chipCount = chips.length;

	useEffect(() => {
		const isChipGone = chipCount < previousCountRef.current;
		if (isChipGone && document.activeElement === document.body) {
			const target =
				listRef.current ?? document.getElementById(LEDGER_HEADING_ID);
			target?.focus({ preventScroll: true });
		}
		previousCountRef.current = chipCount;
	}, [chipCount]);

	if (chipCount === 0 && !hasFilters) return null;

	return (
		<div className="selections">
			<ul
				ref={listRef}
				className="chips"
				aria-label="Active selections"
				tabIndex={-1}
			>
				{buildChipItems(chips)}
			</ul>
			{hasFilters ? (
				<Link className="clear-all" href={clearAllHref} replace scroll={false}>
					Clear all
				</Link>
			) : null}
		</div>
	);
}
