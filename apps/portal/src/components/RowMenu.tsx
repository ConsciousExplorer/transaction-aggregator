import {
	type Dispatch,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	type SetStateAction,
	useEffect,
	useId,
	useRef,
	useState
} from "react";
import { Icon } from "@/components/Icons.tsx";
import type { IconName } from "@/lib/category-style.ts";
import { chooseFocusIndex, findFocusedIndex } from "@/lib/menu-focus.ts";

export type MenuItem = { label: string; icon: IconName; onSelect: () => void };

type MenuRefs = {
	kebab: RefObject<HTMLButtonElement | null>;
	menu: RefObject<HTMLDivElement | null>;
	scrim: RefObject<HTMLDivElement | null>;
};

// Closing puts focus back on the kebab, so a keyboard user carries on from the row
function closeMenu(
	setIsOpen: Dispatch<SetStateAction<boolean>>,
	kebabRef: RefObject<HTMLButtonElement | null>
) {
	setIsOpen(false);
	kebabRef.current?.focus();
}

function listMenuItems(menu: HTMLElement) {
	return Array.from(
		menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
	);
}

function focusFirstItem(menu: HTMLDivElement | null) {
	if (menu === null) return;
	listMenuItems(menu)[0]?.focus();
}

// Escape closes the menu. Tab closes it too, with focus back on the kebab first, so the
// browser's own Tab then moves on from the kebab rather than from an item that is gone. The
// arrows, Home and End move focus between the items.
function createMenuKeyHandler(
	setIsOpen: Dispatch<SetStateAction<boolean>>,
	kebabRef: RefObject<HTMLButtonElement | null>
) {
	return function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			closeMenu(setIsOpen, kebabRef);
			return;
		}
		if (event.key === "Tab") {
			closeMenu(setIsOpen, kebabRef);
			return;
		}
		const items = listMenuItems(event.currentTarget);
		const focusedIndex = findFocusedIndex(items, document.activeElement);
		const index = chooseFocusIndex(items.length, focusedIndex, event.key);
		if (index === undefined) return;
		event.preventDefault();
		items[index]?.focus();
	};
}

// A press anywhere but the menu and its kebab closes the menu; the kebab toggles it itself.
// The phone's scrim closes it on its click instead: closing on the press would take the scrim
// away before the tap's click, and the click would land on whatever lay under it.
function createOutsidePressHandler(
	refs: MenuRefs,
	setIsOpen: Dispatch<SetStateAction<boolean>>
) {
	return function closeOnOutsidePress(event: PointerEvent) {
		const target = event.target;
		if (!(target instanceof Node)) return;
		for (const ref of [refs.kebab, refs.menu, refs.scrim]) {
			if (ref.current?.contains(target)) return;
		}
		closeMenu(setIsOpen, refs.kebab);
	};
}

// Choosing an item runs it, then closes the menu. While the row is busy the items are marked
// aria-disabled and choosing one does nothing.
function createItemChooser(
	item: MenuItem,
	isBusy: boolean,
	setIsOpen: Dispatch<SetStateAction<boolean>>,
	kebabRef: RefObject<HTMLButtonElement | null>
) {
	return function chooseItem() {
		if (isBusy) return;
		item.onSelect();
		closeMenu(setIsOpen, kebabRef);
	};
}

function buildMenuItems(
	items: MenuItem[],
	isBusy: boolean,
	setIsOpen: Dispatch<SetStateAction<boolean>>,
	kebabRef: RefObject<HTMLButtonElement | null>
) {
	const elements: ReactNode[] = [];
	for (const item of items) {
		const chooseItem = createItemChooser(item, isBusy, setIsOpen, kebabRef);
		elements.push(
			<button
				key={item.label}
				type="button"
				role="menuitem"
				tabIndex={-1}
				aria-disabled={isBusy}
				onClick={chooseItem}
			>
				<Icon name={item.icon} />
				{item.label}
			</button>
		);
	}
	return elements;
}

// A row's actions behind a round three-dots button. Opened, the menu drops below the button
// and its first item takes focus; the arrow keys, Home and End move between the items. On a
// phone the menu is a sheet at the bottom of the screen over a scrim.
export function RowMenu({
	label,
	items,
	isBusy
}: {
	label: string;
	items: MenuItem[];
	isBusy: boolean;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const menuId = useId();
	const kebabRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const scrimRef = useRef<HTMLDivElement>(null);
	const handleMenuKeyDown = createMenuKeyHandler(setIsOpen, kebabRef);

	useEffect(() => {
		if (isOpen) focusFirstItem(menuRef.current);
	}, [isOpen]);

	// Listens for a press outside only while the menu is open
	useEffect(() => {
		if (!isOpen) return;
		const closeOnOutsidePress = createOutsidePressHandler(
			{ kebab: kebabRef, menu: menuRef, scrim: scrimRef },
			setIsOpen
		);
		document.addEventListener("pointerdown", closeOnOutsidePress);
		return () => {
			document.removeEventListener("pointerdown", closeOnOutsidePress);
		};
	}, [isOpen]);

	return (
		<>
			<button
				ref={kebabRef}
				type="button"
				className="kebab"
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? menuId : undefined}
				onClick={() => setIsOpen(!isOpen)}
			>
				<Icon name="kebab" size={18} />
			</button>
			{isOpen ? (
				<>
					<div
						ref={scrimRef}
						className="menu-scrim"
						aria-hidden="true"
						onClick={() => closeMenu(setIsOpen, kebabRef)}
					/>
					<div
						ref={menuRef}
						id={menuId}
						className="menu"
						role="menu"
						aria-label={label}
						onKeyDown={handleMenuKeyDown}
					>
						{buildMenuItems(items, isBusy, setIsOpen, kebabRef)}
					</div>
				</>
			) : null}
		</>
	);
}
