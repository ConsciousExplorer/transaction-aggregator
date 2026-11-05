import { useRouter } from "next/navigation";
import type { DashboardContext } from "@/components/DashboardScreen.tsx";
import { BlockError } from "@/components/ErrorNotice.tsx";
import { MoneyFlowChart } from "@/components/MoneyFlowChart.tsx";
import {
	type SegmentedLink,
	SegmentedLinks
} from "@/components/SegmentedLinks.tsx";
import { SkeletonChart } from "@/components/Skeleton.tsx";
import { useBffRead } from "@/components/useBffRead.ts";
import { buildBucketTotals, fillMissingBuckets } from "@/lib/buckets.ts";
import {
	buildPeriod,
	INTERVALS_BY_PERIOD,
	type Interval
} from "@/lib/periods.ts";
import {
	buildChartQuery,
	buildFilterHref,
	buildToggleHref
} from "@/lib/transaction-query.ts";
import type { Summary } from "@/lib/types.ts";

const INTERVAL_LABELS: Record<Interval, string> = {
	day: "By day",
	week: "By week",
	month: "By month"
};

// The bucket sizes this period offers, the current one filled. Picking one drops a selected
// bucket, which belongs to the old size's chart.
function buildIntervalLinks(
	searchParams: URLSearchParams,
	months: number,
	currentInterval: Interval
) {
	const links: SegmentedLink[] = [];
	const choices = INTERVALS_BY_PERIOD[months];
	if (choices === undefined) return links;
	for (const interval of choices.offered) {
		links.push({
			href: buildFilterHref(searchParams, "interval", interval),
			label: INTERVAL_LABELS[interval],
			current: interval === currentInterval
		});
	}
	return links;
}

// The summary has a row per bucket and category; the chart draws one column per bucket, the
// empty ones included, across the whole period
function buildChartBuckets(
	body: Summary,
	interval: Interval,
	period: { fromDateTime: string; toDateTime: string }
) {
	return fillMissingBuckets(
		buildBucketTotals(body.data, interval),
		interval,
		period.fromDateTime,
		period.toDateTime
	);
}

// Selecting a bucket replaces the URL without a scroll, so the chart stays where it is
function createBucketSelector(
	router: ReturnType<typeof useRouter>,
	searchParams: URLSearchParams
) {
	return function selectBucket(bucket: string) {
		router.replace(buildToggleHref(searchParams, "bucket", bucket), {
			scroll: false
		});
	};
}

// The block's title and the bucket size control; the screen's loading placeholder draws the
// same head, so the block does not move when the screen can read the URL
export function ChartHead({
	searchParams,
	months,
	interval
}: {
	searchParams: URLSearchParams;
	months: number;
	interval: Interval;
}) {
	return (
		<div className="panel-head">
			<h2 id="chart-heading">Money in and out</h2>
			<SegmentedLinks
				label="Bucket size"
				links={buildIntervalLinks(searchParams, months, interval)}
			/>
		</div>
	);
}

// The chart block: its own read of the period by bucket (it ignores the selected bucket, so
// every bar stays on screen to be picked, and honours the selected category), the bucket
// size control in its head
export function ChartPanel(context: DashboardContext) {
	const router = useRouter();
	const period = buildPeriod(context.months, context.now);
	const read = useBffRead<Summary>(
		`/bff/summary?${buildChartQuery(context.searchParams, context.now, context.interval)}`,
		context.reloadCount
	);
	const isBusy = read.status === "ready" && read.isBusy;
	const buckets =
		read.body === undefined
			? undefined
			: buildChartBuckets(read.body, context.interval, period);
	const selectBucket = createBucketSelector(router, context.searchParams);

	return (
		<section
			className="chart-block panel"
			aria-labelledby="chart-heading"
			aria-busy={isBusy}
		>
			<ChartHead
				searchParams={context.searchParams}
				months={context.months}
				interval={context.interval}
			/>
			{read.status === "failed" ? (
				<BlockError sentence="Couldn't load the chart." onRetry={read.retry} />
			) : null}
			{read.status === "loading" ? <SkeletonChart /> : null}
			{buckets === undefined || read.body === undefined ? null : (
				<MoneyFlowChart
					buckets={buckets}
					interval={context.interval}
					currency={read.body.totals.netAmount.currency}
					selectedBucket={context.selectedBucket}
					onSelect={selectBucket}
				/>
			)}
		</section>
	);
}
