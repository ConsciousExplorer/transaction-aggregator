import { Icon } from "@/components/Icons.tsx";
import {
	buildHueClassName,
	type CategoryHue,
	type IconName,
	readCategoryHue,
	readCategoryIconName,
	readTypeIconName
} from "@/lib/category-style.ts";
import type { TransactionType } from "@/lib/types.ts";

// A row's badge is 36px with an 18px icon; a picker option's is 28px with a 16px icon
type BadgeSize = "row" | "option";

const BADGE_ICON_SIZES: Record<BadgeSize, number> = { row: 18, option: 16 };

// The icon in the dark of a hue on a pale tint of it, in a circle. Decoration only: the
// label beside it carries the words.
function HueBadge({
	hue,
	iconName,
	size
}: {
	hue: CategoryHue;
	iconName: IconName;
	size: BadgeSize;
}) {
	return (
		<span
			className={`badge badge-${size} ${buildHueClassName(hue)}`}
			aria-hidden="true"
		>
			<Icon name={iconName} size={BADGE_ICON_SIZES[size]} />
		</span>
	);
}

export function CategoryBadge({
	slug,
	size
}: {
	slug: string;
	size: BadgeSize;
}) {
	return (
		<HueBadge
			hue={readCategoryHue(slug)}
			iconName={readCategoryIconName(slug)}
			size={size}
		/>
	);
}

// A transaction type has no colour of its own, so its badge is neutral
export function TypeBadge({
	transactionType,
	size
}: {
	transactionType: TransactionType;
	size: BadgeSize;
}) {
	return (
		<HueBadge
			hue="neutral"
			iconName={readTypeIconName(transactionType)}
			size={size}
		/>
	);
}

// The table's 10px mark of a category's hue, beside its label
export function CategoryDot({ slug }: { slug: string }) {
	return (
		<span
			className={`dot ${buildHueClassName(readCategoryHue(slug))}`}
			aria-hidden="true"
		/>
	);
}
