import { useRouter } from "next/navigation";
import { CategoryRows } from "@/components/CategoryRows.tsx";
import type { DashboardContext } from "@/components/DashboardScreen.tsx";
import { BlockError } from "@/components/ErrorNotice.tsx";
import {
	type SegmentedLink,
	SegmentedLinks
} from "@/components/SegmentedLinks.tsx";
import { SkeletonCategoryRows, SkeletonRing } from "@/components/Skeleton.tsx";
import { SpendingRing } from "@/components/SpendingRing.tsx";
import { TypeRows } from "@/components/TypeRows.tsx";
import { type ReadState, useBffRead } from "@/components/useBffRead.ts";
import type { CategoryFigures } from "@/lib/categories.ts";
import {
	describeTransactionCount,
	formatMoney,
	formatNetAmount,
	formatSignedMoney
} from "@/lib/money.ts";
import { buildRingSegments, calculateMonthlyAverage } from "@/lib/ring.ts";
import {
	buildByTypeQuery,
	buildFilterHref,
	buildToggleHref,
	isGroupedByType
} from "@/lib/transaction-query.ts";
import {
	orderTypeRows,
	sumMoneyOutMinor,
	TRANSACTION_TYPES
} from "@/lib/type-summary.ts";
import type { Category, Summary, TypeSummary } from "@/lib/types.ts";

type SpendingBlockProps = DashboardContext & {
	figures: Record<string, CategoryFigures> | undefined;
	totals: Summary["totals"] | undefined;
	ranked: Category[] | undefined;
	// The figures' currency, there whenever the figures are
	currency: string | undefined;
	// The window the ring covers, such as "last 12 months"
	ringCaption: string;
	// Each category running above its usual month, by slug; empty when that is not shown
	usualDeltaByCategory: Record<string, number>;
	isBusy: boolean;
	// The figures read has landed with no newer read running, so its body answers the URL's
	// period
	isFiguresSettled: boolean;
	isFailed: boolean;
	onRetry: () => void;
};

// The list groups spending by category (the default) or by transaction type, kept in the URL
function buildGroupLinks(searchParams: URLSearchParams) {
	const isTypeGroup = isGroupedByType(searchParams);
	const links: SegmentedLink[] = [
		{
			href: buildFilterHref(searchParams, "group", "category"),
			label: "Category",
			current: !isTypeGroup
		},
		{
			href: buildFilterHref(searchParams, "group", "type"),
			label: "Type",
			current: isTypeGroup
		}
	];
	return links;
}

// The list's title and its grouping tabs; the screen's loading placeholder draws the same
// head, so the card does not move when the screen can read the URL
export function SpendingHead({
	searchParams
}: {
	searchParams: URLSearchParams;
}) {
	return (
		<div className="panel-head">
			<h2 id="spending-heading">Where it went</h2>
			<SegmentedLinks
				label="Group spending by"
				links={buildGroupLinks(searchParams)}
			/>
		</div>
	);
}

// Selecting a row, a category or a transaction type, replaces the URL without a scroll; the
// selected row deselects
function createRowSelector(
	router: ReturnType<typeof useRouter>,
	searchParams: URLSearchParams,
	name: "category" | "transactionType"
) {
	return function selectRow(value: string) {
		router.replace(buildToggleHref(searchParams, name, value), {
			scroll: false
		});
	};
}

// The Type tab's rows are read only while the tab shows; an undefined path reads nothing
function buildByTypePath(context: DashboardContext) {
	if (!isGroupedByType(context.searchParams)) return undefined;
	const query = buildByTypeQuery(
		context.searchParams,
		context.now,
		context.selectedBucket
	);
	return `/bff/summary/by-type?${query}`;
}

// Money in is green with its plus once there is some; a zero prints as plainly as every other
// zero
function formatMoneyIn(totals: Summary["totals"]) {
	if (totals.credit.total.amountMinor === 0)
		return formatMoney(0, totals.credit.total.currency);
	return formatSignedMoney(totals.credit.total, "credit");
}

// Under the ring, two tiles: money in and the net. The count sentence says which
// transactions the figures hold.
function PeriodFigures({ totals }: { totals: Summary["totals"] }) {
	return (
		<>
			<dl className="period-figures">
				<div className="period-figure">
					<dt>Money in</dt>
					<dd
						className={
							totals.credit.total.amountMinor === 0 ? undefined : "period-in"
						}
					>
						{formatMoneyIn(totals)}
					</dd>
				</div>
				<div className="period-figure">
					<dt>Net</dt>
					<dd>{formatNetAmount(totals.netAmount)}</dd>
				</div>
			</dl>
			<p className="period-count">
				{describeTransactionCount(totals.transactionCount)} completed. Pending,
				failed and reversed ones are in the list.
			</p>
		</>
	);
}

// The ring and the tiles once both reads are in; the placeholder until then, and nothing
// beside a failed read that never landed. The monthly average divides the total by the URL's
// months, so it shows only while the figures are settled: during a new period's read, and
// after a failed one, the total on screen may be another period's. The card is dimmed while
// the figures are read, so the line drops out and comes back when the read lands.
function RingColumn({
	figures,
	totals,
	ranked,
	currency,
	caption,
	months,
	selectedBucket,
	isFiguresSettled,
	isFailed
}: {
	figures: Record<string, CategoryFigures> | undefined;
	totals: Summary["totals"] | undefined;
	ranked: Category[] | undefined;
	currency: string | undefined;
	caption: string;
	months: number;
	selectedBucket: string | undefined;
	isFiguresSettled: boolean;
	isFailed: boolean;
}) {
	if (
		figures === undefined ||
		totals === undefined ||
		ranked === undefined ||
		currency === undefined
	) {
		if (isFailed) return null;
		return <SkeletonRing />;
	}
	const monthlyAverageMinor = isFiguresSettled
		? calculateMonthlyAverage(
				totals.debit.total.amountMinor,
				months,
				selectedBucket
			)
		: undefined;
	return (
		<>
			<SpendingRing
				segments={buildRingSegments(ranked, figures)}
				totalMinor={totals.debit.total.amountMinor}
				currency={currency}
				caption={caption}
				monthlyAverageMinor={monthlyAverageMinor}
			/>
			<PeriodFigures totals={totals} />
		</>
	);
}

// The Category tab: a sentence with Retry when the spending's reads fail, the categories with
// transactions ranked by money out once both reads are in, and placeholder rows until then.
// Each row's menu remaps its category, and a row running above its usual month says by how
// much.
function CategoryGroup({
	figures,
	totals,
	ranked,
	currency,
	usualDeltaByCategory,
	isFailed,
	onRetry,
	context,
	onSelect
}: {
	figures: Record<string, CategoryFigures> | undefined;
	totals: Summary["totals"] | undefined;
	ranked: Category[] | undefined;
	currency: string | undefined;
	usualDeltaByCategory: Record<string, number>;
	isFailed: boolean;
	onRetry: () => void;
	context: DashboardContext;
	onSelect: (slug: string) => void;
}) {
	return (
		<>
			{isFailed ? (
				<BlockError sentence="Couldn't load the spending." onRetry={onRetry} />
			) : null}
			{ranked === undefined && !isFailed ? <SkeletonCategoryRows /> : null}
			{ranked === undefined ||
			figures === undefined ||
			totals === undefined ||
			currency === undefined ? null : (
				<CategoryRows
					ranked={ranked}
					categories={context.categories}
					figures={figures}
					currency={currency}
					periodMoneyOutMinor={totals.debit.total.amountMinor}
					usualDeltaByCategory={usualDeltaByCategory}
					selectedCategory={context.selectedCategory}
					onSelect={onSelect}
					onChanged={context.onChanged}
					onFailed={context.onFailed}
				/>
			)}
		</>
	);
}

// The Type tab: the four transaction types ranked by money out once their read is in,
// placeholder rows until then, one for each type, and a sentence with Retry when the read
// fails. The types are read without the type filter, so each row's share is of every type's
// money out together.
function TypeGroup({
	typesRead,
	selectedType,
	onSelect
}: {
	typesRead: ReadState<TypeSummary> & { retry: () => void };
	selectedType: string | undefined;
	onSelect: (transactionType: string) => void;
}) {
	const body = typesRead.body;
	return (
		<>
			{typesRead.status === "failed" ? (
				<BlockError
					sentence="Couldn't load the types."
					onRetry={typesRead.retry}
				/>
			) : null}
			{typesRead.status === "loading" ? (
				<SkeletonCategoryRows
					rowCount={TRANSACTION_TYPES.length}
					hasMenus={false}
				/>
			) : null}
			{body === undefined ? null : (
				<TypeRows
					rows={orderTypeRows(body.data)}
					periodMoneyOutMinor={sumMoneyOutMinor(body.data)}
					selectedType={selectedType}
					onSelect={onSelect}
				/>
			)}
		</>
	);
}

// Where the money went in the period, or in the selected bucket: the ring of money out by
// category with the tiles under it, and beside it the categories with transactions, or every
// transaction type, ranked by money out. The ring and tiles always show the whole window,
// never the selected category, so every category stays on the ring to compare. Selecting a
// category or a type filters the chart and the list, and a type the ring too; a category
// row's menu remaps it.
// When the spending's reads fail, the Category tab says so above its rows. The Type tab's
// list is the types' own read, so there the failure shows in the ring column instead.
export function SpendingBlock({
	figures,
	totals,
	ranked,
	currency,
	ringCaption,
	usualDeltaByCategory,
	isBusy,
	isFiguresSettled,
	isFailed,
	onRetry,
	...context
}: SpendingBlockProps) {
	const router = useRouter();
	const selectCategory = createRowSelector(
		router,
		context.searchParams,
		"category"
	);
	const selectType = createRowSelector(
		router,
		context.searchParams,
		"transactionType"
	);
	const isTypeGroup = isGroupedByType(context.searchParams);
	const typesRead = useBffRead<TypeSummary>(
		buildByTypePath(context),
		context.reloadCount
	);
	// Off the Type tab the types' read is left as it was, so only the shown tab can dim the card
	const isTypesBusy =
		isTypeGroup && typesRead.status === "ready" && typesRead.isBusy;

	return (
		<section
			className="spending-block panel"
			aria-labelledby="spending-heading"
			aria-busy={isBusy || isTypesBusy}
		>
			<div className="hero-ring">
				{isTypeGroup && isFailed ? (
					<BlockError
						sentence="Couldn't load the spending."
						onRetry={onRetry}
					/>
				) : null}
				<RingColumn
					figures={figures}
					totals={totals}
					ranked={ranked}
					currency={currency}
					caption={ringCaption}
					months={context.months}
					selectedBucket={context.selectedBucket}
					isFiguresSettled={isFiguresSettled}
					isFailed={isFailed}
				/>
			</div>
			<div className="hero-categories">
				<SpendingHead searchParams={context.searchParams} />
				{isTypeGroup ? (
					<TypeGroup
						typesRead={typesRead}
						selectedType={
							context.searchParams.get("transactionType") ?? undefined
						}
						onSelect={selectType}
					/>
				) : (
					<CategoryGroup
						figures={figures}
						totals={totals}
						ranked={ranked}
						currency={currency}
						usualDeltaByCategory={usualDeltaByCategory}
						isFailed={isFailed}
						onRetry={onRetry}
						context={context}
						onSelect={selectCategory}
					/>
				)}
			</div>
		</section>
	);
}
