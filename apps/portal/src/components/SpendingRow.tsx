import type { ReactNode } from "react";

function buildRowClassName(isEmpty: boolean, hasActions: boolean) {
	const classNames = ["spending-row"];
	if (isEmpty) classNames.push("spending-row-empty");
	if (hasActions) classNames.push("spending-row-with-actions");
	return classNames.join(" ");
}

// One row of the spending card's list, a category or a transaction type: its badge, its label
// over a subline, and its money out over the average per transaction. All of that is one
// button; pressing it selects what it stands for, and pressing the selected row clears it. A
// row with nothing in the period is greyed. A row's actions, such as a category's menu, sit
// beside the button in the row, never inside it, so pressing them never selects the row.
export function SpendingRow({
	selectionValue,
	badge,
	label,
	subline,
	note,
	amountLabel,
	averageLabel,
	isEmpty,
	isSelected,
	actions,
	onSelect
}: {
	// What onSelect is called with: a category's slug or a transaction type
	selectionValue: string;
	badge: ReactNode;
	label: string;
	subline: ReactNode;
	// A third line under the subline, such as what a remapped category is shown as
	note?: string | undefined;
	amountLabel: string;
	averageLabel?: string | undefined;
	isEmpty: boolean;
	isSelected: boolean;
	actions?: ReactNode;
	onSelect: (selectionValue: string) => void;
}) {
	return (
		<div className={buildRowClassName(isEmpty, actions !== undefined)}>
			<button
				type="button"
				className="spending-row-select"
				aria-pressed={isSelected}
				onClick={() => onSelect(selectionValue)}
			>
				{badge}
				<span className="spending-row-text">
					<span className="spending-row-label">{label}</span>
					<span className="spending-row-subline">{subline}</span>
					{note === undefined ? null : (
						<span className="spending-row-note">{note}</span>
					)}
				</span>
				<span className="spending-row-figures">
					<span className="spending-row-amount">{amountLabel}</span>
					{averageLabel === undefined ? null : (
						<span className="spending-row-average">{averageLabel}</span>
					)}
				</span>
			</button>
			{actions === undefined ? null : (
				<div className="spending-row-actions">{actions}</div>
			)}
		</div>
	);
}
