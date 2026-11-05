import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useState
} from "react";
import { CategoryDot } from "@/components/CategoryBadge.tsx";
import {
	CategoryPicker,
	createPickerCloser,
	createPickerOpener
} from "@/components/CategoryPicker.tsx";
import { type MenuItem, RowMenu } from "@/components/RowMenu.tsx";
import { TransactionDetail } from "@/components/TransactionDetail.tsx";
import { sendJson } from "@/lib/bff-client.ts";
import { formatTransactionDate } from "@/lib/dates.ts";
import { splitLastWord } from "@/lib/description.ts";
import { STATUS_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/labels.ts";
import { formatSignedMoney } from "@/lib/money.ts";
import type { Category, Transaction } from "@/lib/types.ts";

// The ledger's table: a row's menu re-categorises its transaction in the category picker,
// resets it to the bank's category, or opens the transaction's detail beneath the row, as the
// description does

async function recategoriseTransaction(
	transactionId: string,
	categoryId: number
) {
	await sendJson(
		"PUT",
		`/bff/transactions/${encodeURIComponent(transactionId)}/category`,
		{ categoryId }
	);
}

async function resetTransactionCategory(transactionId: string) {
	await sendJson(
		"DELETE",
		`/bff/transactions/${encodeURIComponent(transactionId)}/category`
	);
}

function findCategory(categories: Category[], slug: string) {
	for (const category of categories) {
		if (category.category === slug) return category;
	}
	return undefined;
}

// "−R 952,20 · 31 Aug 2026 · Card": which transaction the picker is choosing for
function describeTransactionFacts(transaction: Transaction) {
	const amount = formatSignedMoney(
		transaction.amount,
		transaction.creditDebitIndicator
	);
	const date = formatTransactionDate(transaction.occurredAt);
	const transactionType = TRANSACTION_TYPE_LABELS[transaction.transactionType];
	return `${amount} · ${date} · ${transactionType}`;
}

// What a transaction row's writes read and set: whether one is running, the row's note of the
// category it had before a change, and the list's callbacks
type TransactionRowWriteContext = {
	isSaving: boolean;
	setIsSaving: Dispatch<SetStateAction<boolean>>;
	setChangedFromLabel: Dispatch<SetStateAction<string | undefined>>;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

// Picking a category re-categorises the row's transaction. The row is busy until the write
// settles, and a pick made while one runs is ignored. Once the write lands the row notes the
// category it had; picking the category it already has writes nothing.
function createRecategoriseHandler(
	transactionId: string,
	currentCategory: Category | undefined,
	currentLabel: string,
	context: TransactionRowWriteContext
) {
	return function handleRecategorise(categoryId: number) {
		if (context.isSaving) return;
		if (categoryId === currentCategory?.categoryId) return;
		context.setIsSaving(true);
		recategoriseTransaction(transactionId, categoryId)
			.then(() => {
				context.setChangedFromLabel(currentLabel);
				context.onChanged();
			}, context.onFailed)
			.finally(() => context.setIsSaving(false));
	};
}

// Reset goes back to the category the bank gave the transaction, so the row's note of a
// change goes too
function createResetHandler(
	transactionId: string,
	context: TransactionRowWriteContext
) {
	return function handleReset() {
		if (context.isSaving) return;
		context.setIsSaving(true);
		resetTransactionCategory(transactionId)
			.then(() => {
				context.setChangedFromLabel(undefined);
				context.onChanged();
			}, context.onFailed)
			.finally(() => context.setIsSaving(false));
	};
}

function createDetailToggler(
	transactionId: string,
	onToggleDetail: (transactionId: string) => void
) {
	return function toggleDetail() {
		onToggleDetail(transactionId);
	};
}

type TransactionRowProps = {
	transaction: Transaction;
	categories: Category[];
	isOpen: boolean;
	onToggleDetail: (transactionId: string) => void;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

// The row, and when it is open, the detail row under it. The detail row spans every column,
// and its id is what the description button controls. While a write runs the row is busy and
// its menu's items are aria-disabled. After a change lands the category cell says what the
// category was, until the screen is left or the category is reset. The picker is a modal
// dialog, so it can sit in the actions cell.
function TransactionRow({
	transaction,
	categories,
	isOpen,
	onToggleDetail,
	onChanged,
	onFailed
}: TransactionRowProps) {
	const [isSaving, setIsSaving] = useState(false);
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [changedFromLabel, setChangedFromLabel] = useState<string | undefined>(
		undefined
	);
	const category = findCategory(categories, transaction.category);
	const categoryLabel = category?.label ?? transaction.category;
	const context: TransactionRowWriteContext = {
		isSaving,
		setIsSaving,
		setChangedFromLabel,
		onChanged,
		onFailed
	};
	const handleRecategorise = createRecategoriseHandler(
		transaction.transactionId,
		category,
		categoryLabel,
		context
	);
	const handleReset = createResetHandler(transaction.transactionId, context);
	const toggleDetail = createDetailToggler(
		transaction.transactionId,
		onToggleDetail
	);
	const openPicker = createPickerOpener(setIsPickerOpen);
	const closePicker = createPickerCloser(setIsPickerOpen);
	// The third item toggles the detail, so it says which way it goes
	const menuItems: MenuItem[] = [
		{ label: "Change category…", icon: "swap", onSelect: openPicker },
		{
			label: "Reset to the bank's category",
			icon: "reset",
			onSelect: handleReset
		},
		{
			label: isOpen ? "Close details" : "Open details",
			icon: "detail",
			onSelect: toggleDetail
		}
	];
	const isCredit = transaction.creditDebitIndicator === "credit";
	const detailId = `detail-${transaction.transactionId}`;
	// The chevron is drawn after the last word, and the two never part across a line
	const descriptionParts = splitLastWord(transaction.shortDescription);

	return (
		<>
			<tr aria-busy={isSaving}>
				<td className="cell-date">
					{formatTransactionDate(transaction.occurredAt)}
				</td>
				<td className="cell-description">
					<button
						type="button"
						className="description-toggle"
						aria-expanded={isOpen}
						aria-controls={detailId}
						onClick={toggleDetail}
					>
						<span className="description">
							{descriptionParts.leading}
							<span className="description-end">
								{descriptionParts.lastWord}
							</span>
						</span>
						<span className="description-type">
							{TRANSACTION_TYPE_LABELS[transaction.transactionType]}
						</span>
					</button>
				</td>
				<td className="cell-category">
					<span className="category-cell">
						<CategoryDot slug={transaction.category} />
						<span>{categoryLabel}</span>
					</span>
					{changedFromLabel === undefined ? null : (
						<span className="changed">Changed · was {changedFromLabel}</span>
					)}
				</td>
				<td
					className={
						isCredit ? "cell-amount amount amount-in" : "cell-amount amount"
					}
				>
					{formatSignedMoney(
						transaction.amount,
						transaction.creditDebitIndicator
					)}
				</td>
				<td className="cell-status">
					{transaction.status === "completed" ? (
						STATUS_LABELS.completed
					) : (
						<span className={`chip chip-${transaction.status}`}>
							{STATUS_LABELS[transaction.status]}
						</span>
					)}
				</td>
				<td className="cell-actions">
					<RowMenu
						label={`Actions for ${transaction.shortDescription}`}
						items={menuItems}
						isBusy={isSaving}
					/>
					{isPickerOpen ? (
						<CategoryPicker
							title={`Category for ${transaction.shortDescription}`}
							subtitle={describeTransactionFacts(transaction)}
							categories={categories}
							currentCategoryId={category?.categoryId}
							resetLabel="Reset to the bank's category"
							onPick={handleRecategorise}
							onReset={handleReset}
							onClose={closePicker}
						/>
					) : null}
				</td>
			</tr>
			{isOpen ? (
				<tr className="detail-row" id={detailId}>
					<td className="detail-cell" colSpan={6}>
						<TransactionDetail transactionId={transaction.transactionId} />
					</td>
				</tr>
			) : null}
		</>
	);
}

export type TransactionTableProps = {
	transactions: Transaction[];
	categories: Category[];
	openTransactionId: string | undefined;
	onToggleDetail: (transactionId: string) => void;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

export function TransactionTable(props: TransactionTableProps) {
	const rows: ReactNode[] = [];
	for (const transaction of props.transactions) {
		rows.push(
			<TransactionRow
				key={transaction.transactionId}
				transaction={transaction}
				categories={props.categories}
				isOpen={props.openTransactionId === transaction.transactionId}
				onToggleDetail={props.onToggleDetail}
				onChanged={props.onChanged}
				onFailed={props.onFailed}
			/>
		);
	}
	return (
		<table className="transactions" aria-label="Transactions">
			<thead>
				<tr>
					<th scope="col">Date</th>
					<th scope="col">Description</th>
					<th scope="col">Category</th>
					<th scope="col" className="cell-amount">
						Amount
					</th>
					<th scope="col">Status</th>
					<th scope="col" className="cell-actions">
						<span className="visually-hidden">Actions</span>
					</th>
				</tr>
			</thead>
			<tbody>{rows}</tbody>
		</table>
	);
}
