import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useEffect,
	useRef,
	useState
} from "react";
import { CategoryBadge } from "@/components/CategoryBadge.tsx";
import {
	CategoryPicker,
	createPickerCloser,
	createPickerOpener
} from "@/components/CategoryPicker.tsx";
import { type MenuItem, RowMenu } from "@/components/RowMenu.tsx";
import { SpendingRow } from "@/components/SpendingRow.tsx";
import { sendJson } from "@/lib/bff-client.ts";
import {
	type CategoryFigures,
	listShownCategories,
	readCategoryFigures
} from "@/lib/categories.ts";
import { describeRowAverage, describeRowSubline } from "@/lib/spending-text.ts";
import type { Category } from "@/lib/types.ts";
import { describeUsualDelta } from "@/lib/usual.ts";

// The spending card's category rows: each selects its category, and its menu shows the
// category as another one or removes that remap. The bank's own categorisation stays as it
// is; a remap changes how every block shows the category.

// A phone shows this many rows until "Show all" is pressed
const PHONE_ROW_COUNT = 5;

async function remapCategory(categoryId: number, toCategoryId: number) {
	await sendJson("PUT", `/bff/categories/${categoryId}/mapping`, {
		toCategoryId
	});
}

async function removeRemap(categoryId: number) {
	await sendJson("DELETE", `/bff/categories/${categoryId}/mapping`);
}

// A row past the phone's first few is hidden there until "Show all"; the selected row never is
function buildItemClassName(isBeyondPhoneRows: boolean, isSelected: boolean) {
	if (isBeyondPhoneRows && !isSelected) return "category-item-extra";
	return undefined;
}

// The count and share, and on a category running above its usual month how far above, on a
// line of its own
function buildRowSubline(
	categoryFigures: CategoryFigures,
	periodMoneyOutMinor: number,
	usualDeltaMinor: number | undefined,
	currency: string
) {
	const countAndShare = describeRowSubline(
		categoryFigures.count,
		categoryFigures.moneyOutMinor,
		periodMoneyOutMinor
	);
	if (usualDeltaMinor === undefined) return countAndShare;
	return (
		<>
			{countAndShare}
			<span className="usual">
				{describeUsualDelta(usualDeltaMinor, currency)}
			</span>
		</>
	);
}

function describeRemapNote(category: Category) {
	if (category.mappedTo === undefined) return undefined;
	return `Shown as ${category.mappedTo.label}`;
}

// What a category row's writes read and set: whether one is running, and the screen's
// callbacks
interface CategoryRowWriteContext {
	isSaving: boolean;
	setIsSaving: Dispatch<SetStateAction<boolean>>;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
}

// Picking a category shows the row's category as that one. The row is busy until the write
// settles, and a pick made while one runs is ignored. Picking the category it is already
// shown as writes nothing.
function createRemapHandler(
	category: Category,
	context: CategoryRowWriteContext
) {
	return function handleRemap(toCategoryId: number) {
		if (context.isSaving) return;
		if (toCategoryId === category.mappedTo?.categoryId) return;
		context.setIsSaving(true);
		remapCategory(category.categoryId, toCategoryId)
			.then(context.onChanged, context.onFailed)
			.finally(() => context.setIsSaving(false));
	};
}

// Remove remap shows the category as itself again
function createRemoveRemapHandler(
	categoryId: number,
	context: CategoryRowWriteContext
) {
	return function handleRemoveRemap() {
		if (context.isSaving) return;
		context.setIsSaving(true);
		removeRemap(categoryId)
			.then(context.onChanged, context.onFailed)
			.finally(() => context.setIsSaving(false));
	};
}

interface CategoryRowProps {
	category: Category;
	// Every category, which the picker offers
	categories: Category[];
	categoryFigures: CategoryFigures;
	currency: string;
	periodMoneyOutMinor: number;
	// How far the category runs above its usual month, when it does
	usualDeltaMinor: number | undefined;
	isSelected: boolean;
	isBeyondPhoneRows: boolean;
	onSelect: (slug: string) => void;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
}

// One category's row, with its menu beside the row's button. While a write runs the row is
// busy and its menu's items are aria-disabled. A remapped row says what it is shown as, and
// only then does its menu offer to remove the remap. The picker is a modal dialog, so it can
// sit beside the menu.
function CategoryRow({
	category,
	categories,
	categoryFigures,
	currency,
	periodMoneyOutMinor,
	usualDeltaMinor,
	isSelected,
	isBeyondPhoneRows,
	onSelect,
	onChanged,
	onFailed
}: CategoryRowProps) {
	const [isSaving, setIsSaving] = useState(false);
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const context: CategoryRowWriteContext = {
		isSaving,
		setIsSaving,
		onChanged,
		onFailed
	};
	const handleRemap = createRemapHandler(category, context);
	const handleRemoveRemap = createRemoveRemapHandler(
		category.categoryId,
		context
	);
	const openPicker = createPickerOpener(setIsPickerOpen);
	const closePicker = createPickerCloser(setIsPickerOpen);
	const menuItems: MenuItem[] = [
		{ label: "Show as another category…", icon: "swap", onSelect: openPicker }
	];
	if (category.mappedTo !== undefined) {
		menuItems.push({
			label: "Remove remap",
			icon: "reset",
			onSelect: handleRemoveRemap
		});
	}

	return (
		<li
			className={buildItemClassName(isBeyondPhoneRows, isSelected)}
			aria-busy={isSaving}
		>
			<SpendingRow
				selectionValue={category.category}
				badge={<CategoryBadge slug={category.category} size="row" />}
				label={category.label}
				subline={buildRowSubline(
					categoryFigures,
					periodMoneyOutMinor,
					usualDeltaMinor,
					currency
				)}
				note={describeRemapNote(category)}
				moneyOutMinor={categoryFigures.moneyOutMinor}
				moneyInMinor={categoryFigures.moneyInMinor}
				currency={currency}
				averageLabel={describeRowAverage(
					categoryFigures.moneyOutMinor,
					categoryFigures.moneyOutCount,
					currency
				)}
				isSelected={isSelected}
				actions={
					<>
						<RowMenu
							label={`Actions for ${category.label}`}
							items={menuItems}
							isBusy={isSaving}
						/>
						{isPickerOpen ? (
							<CategoryPicker
								title={`Show ${category.label} as`}
								categories={categories}
								currentCategoryId={category.mappedTo?.categoryId}
								excludedCategoryId={category.categoryId}
								onPick={handleRemap}
								onClose={closePicker}
							/>
						) : null}
					</>
				}
				onSelect={onSelect}
			/>
		</li>
	);
}

interface CategoryRowsProps {
	// Every category ranked by money out, of which those with transactions get a row
	ranked: Category[];
	// Every category in the categories read's order, which the picker lists
	categories: Category[];
	figures: Record<string, CategoryFigures>;
	currency: string;
	// What each row's share is of
	periodMoneyOutMinor: number;
	selectedCategory: string | undefined;
	onSelect: (slug: string) => void;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
	// Each category running above its usual month, by slug, with how far above in minor units;
	// empty when the usual month is not shown
	usualDeltaByCategory: Record<string, number>;
}

function buildCategoryItems(shown: Category[], props: CategoryRowsProps) {
	const items: ReactNode[] = [];
	for (const [index, category] of shown.entries()) {
		items.push(
			<CategoryRow
				key={category.category}
				category={category}
				categories={props.categories}
				categoryFigures={readCategoryFigures(props.figures, category.category)}
				currency={props.currency}
				periodMoneyOutMinor={props.periodMoneyOutMinor}
				usualDeltaMinor={props.usualDeltaByCategory[category.category]}
				isSelected={category.category === props.selectedCategory}
				isBeyondPhoneRows={index >= PHONE_ROW_COUNT}
				onSelect={props.onSelect}
				onChanged={props.onChanged}
				onFailed={props.onFailed}
			/>
		);
	}
	return items;
}

// "Show all" removes itself, so focus moves to the first row it revealed rather than falling
// back to the page; the list takes it when no hidden row is left to reveal
function focusRevealedRow(list: HTMLUListElement | null) {
	if (list === null) return;
	const revealed = list.querySelector<HTMLButtonElement>(
		".category-item-extra .spending-row-select"
	);
	if (revealed === null) list.focus();
	else revealed.focus();
}

// The categories with transactions, ranked by money out. Wide, the rows run down two columns;
// a phone shows the first five and "Show all". The figures hold completed transactions only,
// so with no row to show the sentence says completed: the list below may still hold others.
export function CategoryRows(props: CategoryRowsProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const listRef = useRef<HTMLUListElement>(null);

	// Only "Show all" expands the list, and it goes as it does
	useEffect(() => {
		if (isExpanded) focusRevealedRow(listRef.current);
	}, [isExpanded]);

	const shown = listShownCategories(
		props.ranked,
		props.figures,
		props.selectedCategory
	);
	if (shown.length === 0) {
		return (
			<div className="empty">
				<p>No completed transactions to show.</p>
			</div>
		);
	}

	return (
		<>
			<ul
				ref={listRef}
				tabIndex={-1}
				aria-label="Categories by money out"
				className={
					isExpanded ? "category-rows category-rows-expanded" : "category-rows"
				}
			>
				{buildCategoryItems(shown, props)}
			</ul>
			{shown.length > PHONE_ROW_COUNT && !isExpanded ? (
				<button
					type="button"
					className="button button-text show-all"
					onClick={() => setIsExpanded(true)}
				>
					Show all {shown.length}
				</button>
			) : null}
		</>
	);
}
