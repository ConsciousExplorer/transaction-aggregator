import type { ReactNode } from "react";
import { describeRowAmount, isMoneyInOnly } from "@/lib/spending-text.ts";

function buildRowClassName(isEmpty: boolean, hasActions: boolean) {
	const classNames = ["spending-row"];
	if (isEmpty) classNames.push("spending-row-empty");
	if (hasActions) classNames.push("spending-row-with-actions");
	return classNames.join(" ");
}

// One row of the spending card's list, a category or a transaction type: its badge, its label
// over a subline, and its money out over the average per transaction. All of that is one
// button; pressing it selects what it stands for, and pressing the selected row clears it. A
// row with only money in shows that money in green instead, and a row with nothing in the
// period is greyed. A row's actions, such as a category's menu, sit beside the button in the
// row, never inside it, so pressing them never selects the row.
export function SpendingRow({
	selectionValue,
	badge,
	label,
	subline,
	note,
	moneyOutMinor,
	moneyInMinor,
	currency,
	averageLabel,
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
	moneyOutMinor: number;
	moneyInMinor: number;
	currency: string;
	averageLabel?: string | undefined;
	isSelected: boolean;
	actions?: ReactNode;
	onSelect: (selectionValue: string) => void;
}) {
	const isEmpty = moneyOutMinor === 0 && moneyInMinor === 0;
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
					<span
						className={
							isMoneyInOnly(moneyOutMinor, moneyInMinor)
								? "spending-row-amount spending-row-amount-in"
								: "spending-row-amount"
						}
					>
						{describeRowAmount(moneyOutMinor, moneyInMinor, currency)}
					</span>
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
