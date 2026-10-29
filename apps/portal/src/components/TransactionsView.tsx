"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import {
	describeError,
	type PortalRequestError,
	readJson,
	sendJson
} from "@/lib/bff-client.ts";
import { formatTransactionDate } from "@/lib/dates.ts";
import { STATUS_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/labels.ts";
import { formatSignedMoney } from "@/lib/money.ts";
import { PERIOD_MONTHS } from "@/lib/periods.ts";
import { formatMonth } from "@/lib/summary.ts";
import {
	buildFilterHref,
	buildFirstPageHref,
	buildListQuery,
	buildPageHref,
	hasFilters,
	readMonth,
	readPageNumber,
	readPageSize,
	readPeriodValue
} from "@/lib/transaction-query.ts";
import type { Category, Transaction, TransactionPage } from "@/lib/types.ts";

type ListState =
	| { status: "loading" }
	| { status: "ready"; page: TransactionPage }
	| { status: "failed"; error: PortalRequestError };

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

type SelectOption = { value: string; label: string };

function buildOptions(options: SelectOption[]) {
	const elements: ReactNode[] = [];
	for (const option of options) {
		elements.push(
			<option key={option.value} value={option.value}>
				{option.label}
			</option>
		);
	}
	return elements;
}

type FilterSelectProps = {
	label: string;
	value: string;
	options: SelectOption[];
	onChange: (value: string) => void;
};

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
	return (
		<label className="filter">
			<span className="filter-label">{label}</span>
			<select value={value} onChange={(event) => onChange(event.target.value)}>
				{buildOptions(options)}
			</select>
		</label>
	);
}

// A month opened from the overview's chart shows as the period; picking a period replaces it
function buildPeriodOptions(month: string | undefined) {
	const options: SelectOption[] = [];
	if (month !== undefined) {
		options.push({ value: month, label: formatMonth(month, "long") });
	}
	for (const months of PERIOD_MONTHS) {
		options.push({
			value: String(months),
			label: months === 1 ? "Last month" : `Last ${months} months`
		});
	}
	return options;
}

function buildTypeOptions() {
	const options: SelectOption[] = [{ value: "", label: "All types" }];
	for (const [value, label] of Object.entries(TRANSACTION_TYPE_LABELS)) {
		options.push({ value, label });
	}
	return options;
}

function buildCategoryFilterOptions(categories: Category[]) {
	const options: SelectOption[] = [{ value: "", label: "All categories" }];
	for (const category of categories) {
		options.push({ value: category.category, label: category.label });
	}
	return options;
}

function buildCategoryChoiceOptions(categories: Category[]) {
	const options: SelectOption[] = [];
	for (const category of categories) {
		options.push({ value: String(category.categoryId), label: category.label });
	}
	return options;
}

function findCategory(categories: Category[], slug: string) {
	return categories.find((category) => category.category === slug);
}

type TransactionRowProps = {
	transaction: Transaction;
	categories: Category[];
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

function TransactionRow({
	transaction,
	categories,
	onChanged,
	onFailed
}: TransactionRowProps) {
	const [saving, setSaving] = useState(false);
	const category = findCategory(categories, transaction.category);
	const isCredit = transaction.creditDebitIndicator === "credit";

	return (
		<tr aria-busy={saving}>
			<td className="cell-date">
				{formatTransactionDate(transaction.occurredAt)}
			</td>
			<td className="cell-description">
				<span className="description">{transaction.shortDescription}</span>
				<span className="muted small">
					{TRANSACTION_TYPE_LABELS[transaction.transactionType]}
				</span>
			</td>
			<td className="cell-category">
				{category === undefined ? (
					<span>{transaction.category}</span>
				) : (
					<div className="category-edit">
						<select
							aria-label={`Category for ${transaction.shortDescription}`}
							value={String(category.categoryId)}
							disabled={saving}
							onChange={(event) => {
								setSaving(true);
								recategoriseTransaction(
									transaction.transactionId,
									Number(event.target.value)
								)
									.then(onChanged, onFailed)
									.finally(() => setSaving(false));
							}}
						>
							{buildOptions(buildCategoryChoiceOptions(categories))}
						</select>
						<button
							type="button"
							className="button button-quiet button-small"
							disabled={saving}
							title="Go back to the category the bank gave this transaction"
							onClick={() => {
								setSaving(true);
								resetTransactionCategory(transaction.transactionId)
									.then(onChanged, onFailed)
									.finally(() => setSaving(false));
							}}
						>
							Reset
						</button>
					</div>
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
					<span className="muted small">{STATUS_LABELS.completed}</span>
				) : (
					<span className={`status status-${transaction.status}`}>
						{STATUS_LABELS[transaction.status]}
					</span>
				)}
			</td>
		</tr>
	);
}

type TransactionTableProps = {
	page: TransactionPage;
	categories: Category[];
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

function TransactionTable({
	page,
	categories,
	onChanged,
	onFailed
}: TransactionTableProps) {
	const rows: ReactNode[] = [];
	for (const transaction of page.transactions) {
		rows.push(
			<TransactionRow
				key={transaction.transactionId}
				transaction={transaction}
				categories={categories}
				onChanged={onChanged}
				onFailed={onFailed}
			/>
		);
	}
	return (
		<table className="transactions">
			<thead>
				<tr>
					<th scope="col">Date</th>
					<th scope="col">Description</th>
					<th scope="col">Category</th>
					<th scope="col" className="cell-amount">
						Amount
					</th>
					<th scope="col">Status</th>
				</tr>
			</thead>
			<tbody>{rows}</tbody>
		</table>
	);
}

function Pager({
	searchParams,
	page,
	pageNumber
}: {
	searchParams: URLSearchParams;
	page: TransactionPage;
	pageNumber: number;
}) {
	return (
		<nav className="pager" aria-label="Pages">
			{page.previousCursor ? (
				<Link
					className="button"
					href={buildPageHref(
						searchParams,
						page.previousCursor,
						Math.max(1, pageNumber - 1),
						page.meta
					)}
				>
					Previous page
				</Link>
			) : (
				<span className="button" aria-disabled="true">
					Previous page
				</span>
			)}
			<span className="pager-position">Page {pageNumber}</span>
			{page.nextCursor ? (
				<Link
					className="button"
					href={buildPageHref(
						searchParams,
						page.nextCursor,
						pageNumber + 1,
						page.meta
					)}
				>
					Next page
				</Link>
			) : (
				<span className="button" aria-disabled="true">
					Next page
				</span>
			)}
		</nav>
	);
}

export function TransactionsView() {
	const router = useRouter();
	const readOnlySearchParams = useSearchParams();
	const queryKey = readOnlySearchParams.toString();
	const searchParams = new URLSearchParams(queryKey);
	const pageNumber = readPageNumber(searchParams.get("page"));

	const [categories, setCategories] = useState<Category[]>([]);
	const [state, setState] = useState<ListState>({ status: "loading" });
	const [reloadCount, setReloadCount] = useState(0);
	const [writeError, setWriteError] = useState<PortalRequestError | undefined>(
		undefined
	);

	useEffect(() => {
		const controller = new AbortController();
		readJson("/bff/categories", controller.signal).then(
			(body) => setCategories((body as { categories: Category[] }).categories),
			(error) => {
				if (!controller.signal.aborted) setWriteError(describeError(error));
			}
		);
		return () => controller.abort();
	}, []);

	// reloadCount is a dependency on purpose: a write bumps it to read the page again
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount triggers the reload
	useEffect(() => {
		const controller = new AbortController();
		readJson(
			`/bff/transactions?${buildListQuery(new URLSearchParams(queryKey), new Date())}`,
			controller.signal
		).then(
			(body) => setState({ status: "ready", page: body as TransactionPage }),
			(error) => {
				if (!controller.signal.aborted)
					setState({ status: "failed", error: describeError(error) });
			}
		);
		return () => controller.abort();
	}, [queryKey, reloadCount]);

	const directionOptions = [
		{ value: "", label: "Money in and out" },
		{ value: "credit", label: "Money in" },
		{ value: "debit", label: "Money out" }
	];
	const orderOptions = [
		{ value: "-occurredAt", label: "Newest first" },
		{ value: "occurredAt", label: "Oldest first" }
	];
	const sizeOptions = [
		{ value: "10", label: "10 per page" },
		{ value: "25", label: "25 per page" },
		{ value: "50", label: "50 per page" }
	];

	return (
		<>
			<div className="page-heading">
				<h1>Transactions</h1>
			</div>
			<div className="filters">
				<FilterSelect
					label="Period"
					value={readPeriodValue(searchParams)}
					options={buildPeriodOptions(readMonth(searchParams.get("month")))}
					onChange={(value) =>
						router.push(buildFilterHref(searchParams, "months", value))
					}
				/>
				<FilterSelect
					label="Type"
					value={searchParams.get("transactionType") ?? ""}
					options={buildTypeOptions()}
					onChange={(value) =>
						router.push(buildFilterHref(searchParams, "transactionType", value))
					}
				/>
				<FilterSelect
					label="Category"
					value={searchParams.get("category") ?? ""}
					options={buildCategoryFilterOptions(categories)}
					onChange={(value) =>
						router.push(buildFilterHref(searchParams, "category", value))
					}
				/>
				<FilterSelect
					label="Direction"
					value={searchParams.get("creditDebitIndicator") ?? ""}
					options={directionOptions}
					onChange={(value) =>
						router.push(
							buildFilterHref(searchParams, "creditDebitIndicator", value)
						)
					}
				/>
				<FilterSelect
					label="Order"
					value={searchParams.get("sort") ?? "-occurredAt"}
					options={orderOptions}
					onChange={(value) =>
						router.push(buildFilterHref(searchParams, "sort", value))
					}
				/>
				<FilterSelect
					label="Show"
					value={readPageSize(searchParams.get("limit"))}
					options={sizeOptions}
					onChange={(value) =>
						router.push(buildFilterHref(searchParams, "limit", value))
					}
				/>
			</div>

			{writeError ? <ErrorNotice error={writeError} /> : null}

			{state.status === "loading" ? (
				<p className="loading">Loading your transactions…</p>
			) : null}

			{state.status === "failed" ? (
				<ErrorNotice error={state.error}>
					<Link href={buildFirstPageHref(searchParams)}>
						Back to the first page
					</Link>
				</ErrorNotice>
			) : null}

			{state.status === "ready" && state.page.transactions.length === 0 ? (
				<div className="empty">
					<p>No transactions match these filters.</p>
					{hasFilters(searchParams) ? (
						<Link href="/transactions">Clear the filters</Link>
					) : null}
				</div>
			) : null}

			{state.status === "ready" && state.page.transactions.length > 0 ? (
				<>
					<TransactionTable
						page={state.page}
						categories={categories}
						onChanged={() => {
							setWriteError(undefined);
							setReloadCount((count) => count + 1);
						}}
						onFailed={(error) => setWriteError(describeError(error))}
					/>
					<Pager
						searchParams={searchParams}
						page={state.page}
						pageNumber={pageNumber}
					/>
				</>
			) : null}
		</>
	);
}
