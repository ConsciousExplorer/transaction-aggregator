import type { ReactNode } from "react";
import { TypeBadge } from "@/components/CategoryBadge.tsx";
import { SpendingRow } from "@/components/SpendingRow.tsx";
import { TRANSACTION_TYPE_LABELS } from "@/lib/labels.ts";
import { formatMoney } from "@/lib/money.ts";
import { describeRowAverage, describeRowSubline } from "@/lib/spending-text.ts";
import type { TypeSummaryRow } from "@/lib/types.ts";

// Each row's money carries its currency, so the rows format their own amounts
function buildTypeItems(
	rows: TypeSummaryRow[],
	periodMoneyOutMinor: number,
	selectedType: string | undefined,
	onSelect: (transactionType: string) => void
) {
	const items: ReactNode[] = [];
	for (const row of rows) {
		const moneyOut = row.debit.total;
		items.push(
			<li key={row.transactionType}>
				<SpendingRow
					selectionValue={row.transactionType}
					badge={<TypeBadge transactionType={row.transactionType} size="row" />}
					label={TRANSACTION_TYPE_LABELS[row.transactionType]}
					subline={describeRowSubline(
						row.count,
						moneyOut.amountMinor,
						periodMoneyOutMinor
					)}
					amountLabel={formatMoney(moneyOut.amountMinor, moneyOut.currency)}
					averageLabel={describeRowAverage(
						moneyOut.amountMinor,
						row.debit.count,
						moneyOut.currency
					)}
					isEmpty={
						moneyOut.amountMinor === 0 && row.credit.total.amountMinor === 0
					}
					isSelected={row.transactionType === selectedType}
					onSelect={onSelect}
				/>
			</li>
		);
	}
	return items;
}

// The four transaction types in the order given, each row shaped as a category's. Wide, they
// run down two columns as the categories do; four rows need no "Show all" on a phone.
export function TypeRows({
	rows,
	periodMoneyOutMinor,
	selectedType,
	onSelect
}: {
	rows: TypeSummaryRow[];
	// What each row's share is of
	periodMoneyOutMinor: number;
	// The URL's transactionType, which may name no type
	selectedType: string | undefined;
	onSelect: (transactionType: string) => void;
}) {
	return (
		<ul aria-label="Transaction types by money out" className="category-rows">
			{buildTypeItems(rows, periodMoneyOutMinor, selectedType, onSelect)}
		</ul>
	);
}
