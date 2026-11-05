"use client";

import { useSearchParams } from "next/navigation";
import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useState
} from "react";
import { ChartHead, ChartPanel } from "@/components/ChartPanel.tsx";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import { FilterToolbar } from "@/components/FilterToolbar.tsx";
import {
	LEDGER_HEADING_ID,
	SelectionChips
} from "@/components/SelectionChips.tsx";
import {
	SkeletonChart,
	SkeletonRows,
	SkeletonSpending
} from "@/components/Skeleton.tsx";
import { SpendingBlock, SpendingHead } from "@/components/SpendingBlock.tsx";
import { TitleRow } from "@/components/TitleRow.tsx";
import { TransactionList } from "@/components/TransactionList.tsx";
import { type ReadState, useBffRead } from "@/components/useBffRead.ts";
import { describeError, type PortalRequestError } from "@/lib/bff-client.ts";
import { formatBucket, readBucketInterval } from "@/lib/buckets.ts";
import {
	buildCategoryFigures,
	type CategoryFigures,
	orderCategories,
	readCategoryFigures
} from "@/lib/categories.ts";
import { describeFinding, describeFindingWindow } from "@/lib/finding.ts";
import {
	buildPeriod,
	type Interval,
	readInterval,
	readPeriodMonths
} from "@/lib/periods.ts";
import {
	describeChips,
	describeRingCaption,
	findChipLabel,
	listBucketKeys,
	readSelectedBucket,
	readSelectedCategory,
	type SelectionChip
} from "@/lib/selections.ts";
import {
	buildClearAllHref,
	buildFiguresQuery,
	buildListQuery,
	buildUsualQuery,
	hasFilters,
	isUsualRead
} from "@/lib/transaction-query.ts";
import type { Category, Summary } from "@/lib/types.ts";
import { buildUsualDeltas } from "@/lib/usual.ts";

// Everything a block on the screen reads from: the one "now" every read's window is measured
// from, the URL and what it selects, the categories, and the write callbacks. A write bumps
// reloadCount, and every block reads again.
export type DashboardContext = {
	now: Date;
	searchParams: URLSearchParams;
	months: number;
	interval: Interval;
	selectedBucket: string | undefined;
	selectedCategory: string | undefined;
	categories: Category[];
	reloadCount: number;
	onChanged: () => void;
	onFailed: (error: unknown) => void;
};

// A write landed: clear any earlier write error and read every block again
function createChangedHandler(
	setWriteError: Dispatch<SetStateAction<PortalRequestError | undefined>>,
	setReloadCount: Dispatch<SetStateAction<number>>
) {
	return function onChanged() {
		setWriteError(undefined);
		setReloadCount((count) => count + 1);
	};
}

function createFailedHandler(
	setWriteError: Dispatch<SetStateAction<PortalRequestError | undefined>>
) {
	return function onFailed(error: unknown) {
		setWriteError(describeError(error));
	};
}

// The finding names the top category by money out, so it needs each ranked category's figure
function listMoneyOut(
	ranked: Category[],
	figures: Record<string, CategoryFigures>
) {
	const moneyOut = [];
	for (const category of ranked) {
		moneyOut.push({
			label: category.label,
			moneyOutMinor: readCategoryFigures(figures, category.category)
				.moneyOutMinor
		});
	}
	return moneyOut;
}

// The finding speaks of the selected bucket when there is one, else of the whole period
function describeSelectedWindow(
	months: number,
	selectedBucket: string | undefined
) {
	if (selectedBucket === undefined)
		return describeFindingWindow(months, undefined, false);
	return describeFindingWindow(
		months,
		formatBucket(selectedBucket, "long"),
		readBucketInterval(selectedBucket) === "day"
	);
}

// On the Category tab over 1 or 3 months with no bucket picked, the rows compare each category
// with its usual month, so the last 12 months are read too; otherwise the undefined path reads
// nothing
function buildUsualPath(
	searchParams: URLSearchParams,
	now: Date,
	months: number,
	selectedBucket: string | undefined
) {
	if (!isUsualRead(searchParams, months, selectedBucket)) return undefined;
	return `/bff/summary?${buildUsualQuery(searchParams, now)}`;
}

// The deltas divide the figures by the URL's months and measure them against the year's read,
// so they are built only while the rows show the usual month, and only when both reads have
// landed with no newer read running. A read keeps its last body while a new path is read, when
// its path turns undefined and when it fails, and that body may answer an earlier URL; until
// both reads answer this one, the rows show no line. The card is dimmed while the figures are
// read, so the lines drop out and come back when the reads land.
function readUsualDeltas(
	searchParams: URLSearchParams,
	months: number,
	selectedBucket: string | undefined,
	figures: Record<string, CategoryFigures> | undefined,
	isFiguresSettled: boolean,
	usualRead: ReadState<Summary>
) {
	if (!isUsualRead(searchParams, months, selectedBucket)) return {};
	if (figures === undefined || !isFiguresSettled) return {};
	if (usualRead.status !== "ready" || usualRead.isBusy) return {};
	return buildUsualDeltas(
		figures,
		buildCategoryFigures(usualRead.body.data),
		months
	);
}

// The spending card draws on two reads, the categories and the figures; its Retry runs
// whichever of them failed
function createSpendingRetry(
	categoriesRead: { status: string; retry: () => void },
	figuresRead: { status: string; retry: () => void }
) {
	return function retrySpending() {
		if (categoriesRead.status === "failed") categoriesRead.retry();
		if (figuresRead.status === "failed") figuresRead.retry();
	};
}

// One outlined block of the grid, its class naming its grid area, with the head the loaded
// block draws
function Panel({
	name,
	head,
	children
}: {
	name: "chart" | "ledger";
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			className={`${name}-block panel`}
			aria-labelledby={`${name}-heading`}
		>
			{head}
			{children}
		</section>
	);
}

// The ledger: its heading, the selection chips, the filters, then the list. The chips and the
// filters stay mounted across URL changes, so a removed chip can hand focus to the chip list
// and a phone's opened filters stay open; the list beneath is keyed on its query, so a new
// filter or selection reads it afresh while opening a row or changing the bucket size does
// not. The heading takes focus when the last chip goes and the chip list with it.
function LedgerBlock({
	context,
	chips
}: {
	context: DashboardContext;
	chips: SelectionChip[];
}) {
	const readKey = buildListQuery(
		context.searchParams,
		context.now,
		context.selectedBucket
	).toString();
	return (
		<section className="ledger-block panel" aria-labelledby={LEDGER_HEADING_ID}>
			<h2 id={LEDGER_HEADING_ID} tabIndex={-1}>
				Transactions
			</h2>
			<SelectionChips
				chips={chips}
				clearAllHref={buildClearAllHref(context.searchParams)}
				hasFilters={hasFilters(context.searchParams)}
			/>
			<FilterToolbar searchParams={context.searchParams} readKey={readKey} />
			<TransactionList
				key={readKey}
				searchParams={context.searchParams}
				now={context.now}
				selectedBucket={context.selectedBucket}
				selectedCategory={context.selectedCategory}
				bucketLabel={findChipLabel(chips, "bucket")}
				categories={context.categories}
				reloadCount={context.reloadCount}
				onChanged={context.onChanged}
				onFailed={context.onFailed}
			/>
		</section>
	);
}

// The one screen: the title row, then the blocks in one column: the spending card, the chart
// and the ledger.
export function DashboardScreen() {
	const readOnlySearchParams = useSearchParams();
	const searchParams = new URLSearchParams(readOnlySearchParams.toString());

	// Fixed once, so every read measures its window from the same instant
	const [now] = useState(() => new Date());
	const [reloadCount, setReloadCount] = useState(0);
	const [writeError, setWriteError] = useState<PortalRequestError | undefined>(
		undefined
	);

	const months = readPeriodMonths(searchParams.get("months"));
	const interval = readInterval(searchParams.get("interval"), months);
	const period = buildPeriod(months, now);
	const bucketKeys = listBucketKeys(interval, period);
	const selectedBucket = readSelectedBucket(searchParams, bucketKeys);
	// A bucket from another period or bucket size is not on the chart, so it is dropped here
	// and every block, chip and link reads the URL without it
	if (selectedBucket === undefined) searchParams.delete("bucket");

	const categoriesRead = useBffRead<{ categories: Category[] }>(
		"/bff/categories",
		reloadCount
	);
	const categories = categoriesRead.body?.categories ?? [];
	const selectedCategory = readSelectedCategory(searchParams, categories);
	// Once the categories are in, a slug that names none of them is dropped the same way, so
	// no block filters on a category no chip shows. Until then the slug stays as it is.
	if (categoriesRead.body !== undefined && selectedCategory === undefined)
		searchParams.delete("category");
	// The chips' labels also name the ring's window and the empty list, so they are built once
	const chips = describeChips(
		searchParams,
		selectedBucket,
		selectedCategory,
		categories
	);

	// One read feeds the spending card and the finding, so the two agree. It ignores the
	// selected category, so every category stays on screen to be picked.
	const figuresRead = useBffRead<Summary>(
		`/bff/summary?${buildFiguresQuery(searchParams, now, selectedBucket)}`,
		reloadCount
	);
	const figuresBody = figuresRead.body;
	const isFiguresBusy = figuresRead.status === "ready" && figuresRead.isBusy;
	const isFiguresFailed = figuresRead.status === "failed";
	// The figures answer the URL as it is now only once their read has landed with no newer one
	// running; while a new period is read, and after a read fails, the body on screen may be an
	// earlier URL's
	const isFiguresSettled =
		figuresRead.status === "ready" && !figuresRead.isBusy;
	const figures =
		figuresBody === undefined
			? undefined
			: buildCategoryFigures(figuresBody.data);
	const totals = figuresBody?.totals;
	// The usual month's read takes the figures' filters over the last 12 months. When it fails,
	// the rows show no usual-month line, even where an earlier read had one; nothing else on the
	// card depends on it.
	const usualRead = useBffRead<Summary>(
		buildUsualPath(searchParams, now, months, selectedBucket),
		reloadCount
	);
	const usualDeltaByCategory = readUsualDeltas(
		searchParams,
		months,
		selectedBucket,
		figures,
		isFiguresSettled,
		usualRead
	);
	const ranked =
		figures === undefined || categoriesRead.body === undefined
			? undefined
			: orderCategories(categories, figures);
	// The finding, like the ring, describes the period or the selected bucket, never the
	// selected category
	const finding =
		totals === undefined || figures === undefined || ranked === undefined
			? undefined
			: describeFinding(
					totals,
					listMoneyOut(ranked, figures),
					describeSelectedWindow(months, selectedBucket)
				);

	const onChanged = createChangedHandler(setWriteError, setReloadCount);
	const onFailed = createFailedHandler(setWriteError);
	const retrySpending = createSpendingRetry(categoriesRead, figuresRead);
	const context: DashboardContext = {
		now,
		searchParams,
		months,
		interval,
		selectedBucket,
		selectedCategory,
		categories,
		reloadCount,
		onChanged,
		onFailed
	};

	return (
		<>
			<TitleRow months={months} finding={finding} searchParams={searchParams} />
			{writeError ? <ErrorNotice error={writeError} /> : null}
			<div className="dashboard">
				<SpendingBlock
					{...context}
					figures={figures}
					totals={totals}
					ranked={ranked}
					currency={figuresBody?.totals.netAmount.currency}
					ringCaption={describeRingCaption(chips, months)}
					usualDeltaByCategory={usualDeltaByCategory}
					isBusy={isFiguresBusy}
					isFiguresSettled={isFiguresSettled}
					isFailed={isFiguresFailed || categoriesRead.status === "failed"}
					onRetry={retrySpending}
				/>
				<ChartPanel {...context} />
				<LedgerBlock context={context} chips={chips} />
			</div>
		</>
	);
}

// The page's Suspense fallback, shown before the URL can be read: the title row at the
// default period and every block's skeleton, so the screen starts where the loaded one puts it
export function DashboardSkeleton() {
	const searchParams = new URLSearchParams();
	const months = readPeriodMonths(searchParams.get("months"));
	return (
		<>
			<TitleRow
				months={months}
				finding={undefined}
				searchParams={searchParams}
			/>
			<div className="dashboard">
				<section
					className="spending-block panel"
					aria-labelledby="spending-heading"
				>
					<SkeletonSpending
						head={<SpendingHead searchParams={searchParams} />}
					/>
				</section>
				<Panel
					name="chart"
					head={
						<ChartHead
							searchParams={searchParams}
							months={months}
							interval={readInterval(null, months)}
						/>
					}
				>
					<SkeletonChart />
				</Panel>
				<Panel
					name="ledger"
					head={<h2 id={LEDGER_HEADING_ID}>Transactions</h2>}
				>
					<FilterToolbar searchParams={searchParams} readKey="" />
					<div className="ledger">
						<SkeletonRows rows={10} />
					</div>
				</Panel>
			</div>
		</>
	);
}
