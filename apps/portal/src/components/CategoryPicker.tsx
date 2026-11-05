import {
	type Dispatch,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	type SetStateAction,
	useEffect,
	useId,
	useRef,
	useState
} from "react";
import { CategoryBadge } from "@/components/CategoryBadge.tsx";
import { Icon } from "@/components/Icons.tsx";
import { filterCategories } from "@/lib/category-search.ts";
import {
	chooseFocusIndex,
	chooseTabStopIndex,
	findFocusedIndex
} from "@/lib/menu-focus.ts";
import type { Category } from "@/lib/types.ts";

// A row's menu opens the picker and the picker's close event closes it; the row keeps whether
// it is open in its own state
export function createPickerOpener(
	setIsPickerOpen: Dispatch<SetStateAction<boolean>>
) {
	return function openPicker() {
		setIsPickerOpen(true);
	};
}

export function createPickerCloser(
	setIsPickerOpen: Dispatch<SetStateAction<boolean>>
) {
	return function closePicker() {
		setIsPickerOpen(false);
	};
}

// A choice closes the dialog after the caller has it; the dialog's close event then tells the
// caller it is closed, and the browser puts focus back where it was before the dialog opened
function createPickAndCloseHandler(
	onPick: (categoryId: number) => void,
	dialogRef: RefObject<HTMLDialogElement | null>
) {
	return function pickAndClose(categoryId: number) {
		onPick(categoryId);
		dialogRef.current?.close();
	};
}

function createResetAndCloseHandler(
	onReset: (() => void) | undefined,
	dialogRef: RefObject<HTMLDialogElement | null>
) {
	return function resetAndClose() {
		onReset?.();
		dialogRef.current?.close();
	};
}

// The dialog opens as a modal. The browser focuses the search; focus moves on to the current
// category, or the first when none is current, so a phone does not raise its keyboard over the
// sheet, and the search stays a tap or a Shift+Tab away. The list scrolls to show the option.
function showAsModal(dialog: HTMLDialogElement) {
	dialog.showModal();
	const option =
		dialog.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
		dialog.querySelector<HTMLButtonElement>('[role="option"]');
	if (option === null) return;
	option.scrollIntoView({ block: "nearest" });
	option.focus({ preventScroll: true });
}

// Where a press began, so a press that starts on the panel and is let go over the backdrop,
// such as a drag that selects text, is not taken for a click on the backdrop
function createPressStartRecorder(
	pressStartRef: RefObject<EventTarget | null>
) {
	return function recordPressStart(event: PointerEvent<HTMLDialogElement>) {
		pressStartRef.current = event.target;
	};
}

// The panel covers the whole dialog, so a press that starts and ends on the dialog element
// itself is a click on the backdrop around it
function createBackdropCloser(pressStartRef: RefObject<EventTarget | null>) {
	return function closeOnBackdropClick(event: MouseEvent<HTMLDialogElement>) {
		const dialog = event.currentTarget;
		if (event.target === dialog && pressStartRef.current === dialog)
			dialog.close();
	};
}

// The arrows, Home and End move focus between the options, and the Tab stop moves with it
function moveFocusBetweenOptions(event: KeyboardEvent<HTMLUListElement>) {
	const options = Array.from(
		event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')
	);
	const focusedIndex = findFocusedIndex(options, document.activeElement);
	const index = chooseFocusIndex(options.length, focusedIndex, event.key);
	if (index === undefined) return;
	event.preventDefault();
	options[index]?.focus();
}

// The list is one Tab stop, so a Tab from the search reaches one option and the next reaches
// the foot. The stop is the option focus was last on, else the current one, else the first;
// focusing an option, as the arrows do, moves the stop to it.
function buildOptionItems(
	matches: Category[],
	currentCategoryId: number | undefined,
	lastFocusedCategoryId: number | undefined,
	setLastFocusedCategoryId: Dispatch<SetStateAction<number | undefined>>,
	pickAndClose: (categoryId: number) => void
) {
	const categoryIds: number[] = [];
	for (const category of matches) {
		categoryIds.push(category.categoryId);
	}
	const tabStopIndex = chooseTabStopIndex(
		categoryIds,
		lastFocusedCategoryId,
		currentCategoryId
	);
	const items: ReactNode[] = [];
	for (const [index, category] of matches.entries()) {
		const isCurrent = category.categoryId === currentCategoryId;
		items.push(
			<li key={category.categoryId} role="none">
				<button
					type="button"
					role="option"
					aria-selected={isCurrent}
					tabIndex={index === tabStopIndex ? 0 : -1}
					onFocus={() => setLastFocusedCategoryId(category.categoryId)}
					onClick={() => pickAndClose(category.categoryId)}
				>
					<CategoryBadge slug={category.category} size="option" />
					<span className="picker-option-label">{category.label}</span>
					{isCurrent ? <Icon name="check" /> : null}
				</button>
			</li>
		);
	}
	return items;
}

// Chooses a category in a modal dialog: a search that narrows the list by label, every
// category with the current one marked, and an optional foot button such as a reset. Escape
// and a click on the backdrop close it without a choice. On a phone it is a sheet at the
// bottom of the screen.
export function CategoryPicker({
	title,
	subtitle,
	categories,
	currentCategoryId,
	excludedCategoryId,
	resetLabel,
	onPick,
	onReset,
	onClose
}: {
	title: string;
	subtitle?: string;
	categories: Category[];
	currentCategoryId?: number;
	// A category left out of the list, such as the one being remapped
	excludedCategoryId?: number;
	// The foot button's words; without them there is no foot
	resetLabel?: string;
	onPick: (categoryId: number) => void;
	onReset?: () => void;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const pressStartRef = useRef<EventTarget | null>(null);
	const titleId = useId();
	const [searchText, setSearchText] = useState("");
	const [lastFocusedCategoryId, setLastFocusedCategoryId] = useState<
		number | undefined
	>(undefined);

	// The dialog opens once it is in the page. Strict Mode runs the effect twice in development,
	// so an open dialog is left alone.
	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog !== null && !dialog.open) showAsModal(dialog);
	}, []);

	const matches = filterCategories(categories, searchText, excludedCategoryId);
	// The status under the list stays in the page, empty while something matches, so a screen
	// reader announces the sentence when a search leaves nothing
	const emptySearchMessage =
		matches.length === 0 && searchText.trim() !== ""
			? "No category matches the search."
			: undefined;
	const pickAndClose = createPickAndCloseHandler(onPick, dialogRef);
	const resetAndClose = createResetAndCloseHandler(onReset, dialogRef);
	const recordPressStart = createPressStartRecorder(pressStartRef);
	const closeOnBackdropClick = createBackdropCloser(pressStartRef);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is the pointer's way out; the keyboard's is Escape, which the dialog handles itself
		<dialog
			ref={dialogRef}
			className="picker"
			aria-labelledby={titleId}
			onClose={onClose}
			onPointerDown={recordPressStart}
			onClick={closeOnBackdropClick}
		>
			<div className="picker-panel">
				<div className="picker-head">
					<h2 id={titleId} className="picker-title">
						{title}
					</h2>
					{subtitle === undefined ? null : (
						<p className="picker-sub">{subtitle}</p>
					)}
				</div>
				<label className="picker-search">
					<Icon name="search" />
					<input
						type="search"
						placeholder="Find a category"
						aria-label="Find a category"
						value={searchText}
						onChange={(event) => setSearchText(event.target.value)}
					/>
				</label>
				<ul
					className="picker-list"
					// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA in HTML permits the listbox role on a ul, and the list is a listbox of options
					role="listbox"
					aria-labelledby={titleId}
					onKeyDown={moveFocusBetweenOptions}
				>
					{buildOptionItems(
						matches,
						currentCategoryId,
						lastFocusedCategoryId,
						setLastFocusedCategoryId,
						pickAndClose
					)}
				</ul>
				<p className="picker-empty" role="status">
					{emptySearchMessage}
				</p>
				{resetLabel === undefined ? null : (
					<div className="picker-foot">
						<button
							type="button"
							className="button button-text"
							onClick={resetAndClose}
						>
							{resetLabel}
						</button>
					</div>
				)}
			</div>
		</dialog>
	);
}
