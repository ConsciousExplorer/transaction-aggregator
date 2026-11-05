import { useRouter } from "next/navigation";
import { useState } from "react";
import { AmountRangeForm } from "@/components/AmountRangeForm.tsx";
import {
	buildOptions,
	type SelectOption
} from "@/components/SelectOptions.tsx";
import { TRANSACTION_TYPE_LABELS } from "@/lib/labels.ts";
import {
	buildAmountRangeHref,
	buildFilterHref
} from "@/lib/transaction-query.ts";

const DIRECTION_OPTIONS: SelectOption[] = [
	{ value: "", label: "Money in and out" },
	{ value: "credit", label: "Money in" },
	{ value: "debit", label: "Money out" }
];

const ORDER_OPTIONS: SelectOption[] = [
	{ value: "-occurredAt", label: "Newest first" },
	{ value: "occurredAt", label: "Oldest first" }
];

function buildTypeOptions() {
	const options: SelectOption[] = [{ value: "", label: "All types" }];
	for (const [value, label] of Object.entries(TRANSACTION_TYPE_LABELS)) {
		options.push({ value, label });
	}
	return options;
}

// A filter navigates to its own URL, so the back button steps back through filters. The
// page stays where it is, beside the toolbar.
function createFilterNavigator(
	router: ReturnType<typeof useRouter>,
	searchParams: URLSearchParams
) {
	return function navigateToFilter(name: string, value: string) {
		router.push(buildFilterHref(searchParams, name, value), { scroll: false });
	};
}

function createAmountRangeNavigator(
	router: ReturnType<typeof useRouter>,
	searchParams: URLSearchParams
) {
	return function navigateToAmountRange(amountMin: string, amountMax: string) {
		router.push(buildAmountRangeHref(searchParams, amountMin, amountMax), {
			scroll: false
		});
	};
}

// A pill holding the filter's name in muted and its select, which shows the chosen value
function FilterSelect({
	label,
	name,
	value,
	options,
	onChange
}: {
	label: string;
	name: string;
	value: string;
	options: SelectOption[];
	onChange: (name: string, value: string) => void;
}) {
	return (
		<label className="pill-select">
			<span className="pill-select-label">{label}:</span>
			<select
				value={value}
				onChange={(event) => onChange(name, event.target.value)}
			>
				{buildOptions(options)}
			</select>
		</label>
	);
}

// The list's filters and its order, as pills on one wrapping row. Every value lives in the
// URL: a select or Apply navigates, and the screen reads the new URL. The amount form is keyed
// on the list's read, so a new read replaces whatever was typed and opening a row keeps it. A
// phone folds the fields behind the Filters button; wide, the button is hidden and the fields
// always show.
export function FilterToolbar({
	searchParams,
	readKey
}: {
	searchParams: URLSearchParams;
	readKey: string;
}) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const navigateToFilter = createFilterNavigator(router, searchParams);
	const navigateToAmountRange = createAmountRangeNavigator(
		router,
		searchParams
	);

	return (
		<div className={isOpen ? "toolbar is-open" : "toolbar"}>
			<button
				type="button"
				className="button disclosure toolbar-toggle"
				aria-expanded={isOpen}
				aria-controls="toolbar-fields"
				onClick={() => setIsOpen(!isOpen)}
			>
				Filters
			</button>
			<div className="toolbar-fields" id="toolbar-fields">
				<FilterSelect
					label="Type"
					name="transactionType"
					value={searchParams.get("transactionType") ?? ""}
					options={buildTypeOptions()}
					onChange={navigateToFilter}
				/>
				<FilterSelect
					label="Direction"
					name="creditDebitIndicator"
					value={searchParams.get("creditDebitIndicator") ?? ""}
					options={DIRECTION_OPTIONS}
					onChange={navigateToFilter}
				/>
				<FilterSelect
					label="Order"
					name="sort"
					value={searchParams.get("sort") ?? "-occurredAt"}
					options={ORDER_OPTIONS}
					onChange={navigateToFilter}
				/>
				<AmountRangeForm
					key={readKey}
					initialMin={searchParams.get("amountMin") ?? ""}
					initialMax={searchParams.get("amountMax") ?? ""}
					onApply={navigateToAmountRange}
				/>
			</div>
		</div>
	);
}
