import type { ReactNode } from "react";
import {
	type BucketTotal,
	chooseBucketLabelRank,
	formatBucket
} from "@/lib/buckets.ts";
import { buildSignedAxis } from "@/lib/chart.ts";
import {
	formatAxisMoney,
	formatAxisMoneyCompact,
	formatMoney
} from "@/lib/money.ts";
import type { Interval } from "@/lib/periods.ts";

// Past this many buckets (a year by week) the columns are a few pixels wide: the minor labels
// are hidden and the bars are drawn narrower
const DENSE_BUCKET_COUNT = 40;

// The widest a bar gets, in the plot's 0–100 horizontal units, so a short period's few
// buckets still draw columns rather than blocks
const MAXIMUM_BAR_WIDTH = 6;

type ChartGeometry = {
	ticks: number[];
	step: number;
	top: number;
	bottom: number;
	range: number;
	zeroY: number;
};

// The signed axis as positions on the plot. The svg's viewBox is 0–100 on both axes, so every
// y here is a percentage of the plot's height, measured down from the top. With nothing in
// and nothing out the axis has no span, so the zero line sits in the middle.
function buildChartGeometry(buckets: BucketTotal[]) {
	let maximumIn = 0;
	let maximumOut = 0;
	for (const bucket of buckets) {
		maximumIn = Math.max(maximumIn, bucket.moneyInMinor);
		maximumOut = Math.max(maximumOut, bucket.moneyOutMinor);
	}
	const axis = buildSignedAxis(maximumIn, maximumOut);
	const span = axis.top - axis.bottom;
	const range = span === 0 ? 1 : span;
	const zeroY = span === 0 ? 50 : (axis.top / range) * 100;
	const geometry: ChartGeometry = {
		ticks: axis.ticks,
		step: axis.step,
		top: axis.top,
		bottom: axis.bottom,
		range,
		zeroY
	};
	return geometry;
}

// A value's place on the plot: zero at the zero line, money in above it, money out below
function calculateTickY(tick: number, geometry: ChartGeometry) {
	return geometry.zeroY - (tick / geometry.range) * 100;
}

function calculateBarHeight(amountMinor: number, geometry: ChartGeometry) {
	return (amountMinor / geometry.range) * 100;
}

// Each bucket has an equal slot across the plot; its bars are centred in it
function chooseBarWidth(slot: number, isDense: boolean) {
	if (isDense) return slot * 0.5;
	return Math.min(slot * 0.6, MAXIMUM_BAR_WIDTH);
}

// With a bucket selected, every other bucket's bars step back to grey
function buildBarClassName(direction: "in" | "out", isDimmed: boolean) {
	const className = `bar bar-${direction}`;
	if (isDimmed) return `${className} bar-dim`;
	return className;
}

function buildLabelClassName(rank: "major" | "minor" | undefined) {
	if (rank === undefined) return "bucket-label";
	return `bucket-label bucket-label-${rank}`;
}

// A tooltip opens over the plot, anchored to the side its column is on, so one near either
// edge stays inside the panel
function buildTooltipClassName(index: number, bucketCount: number) {
	if (index < bucketCount / 2) return "tooltip tooltip-start";
	return "tooltip tooltip-end";
}

function describeBucket(bucket: BucketTotal, currency: string) {
	const moneyIn = formatMoney(bucket.moneyInMinor, currency);
	const moneyOut = formatMoney(bucket.moneyOutMinor, currency);
	return `${formatBucket(bucket.bucket, "long")}: money in ${moneyIn}, money out ${moneyOut}`;
}

// The gutter's labels: one per tick, centred on its gridline, and the "In" and "Out" captions
// on the sides that have money. Each caption is centred half a step from the zero line, midway
// to the first gridline on its side, so it stands apart from the zero's own label rather than
// crowding it. Each tick carries its full and its compact label; the stylesheet shows the
// compact one in a phone's narrower gutter.
function buildAxisLabels(geometry: ChartGeometry) {
	const labels: ReactNode[] = [];
	for (const tick of geometry.ticks) {
		labels.push(
			<span
				key={`tick-${tick}`}
				className="tick"
				style={{ top: `${calculateTickY(tick, geometry)}%` }}
			>
				<span className="tick-full">{formatAxisMoney(tick)}</span>
				<span className="tick-compact">{formatAxisMoneyCompact(tick)}</span>
			</span>
		);
	}
	if (geometry.top > 0) {
		labels.push(
			<span
				key="caption-in"
				className="axis-caption"
				style={{ top: `${calculateTickY(geometry.step / 2, geometry)}%` }}
			>
				In
			</span>
		);
	}
	if (geometry.bottom < 0) {
		labels.push(
			<span
				key="caption-out"
				className="axis-caption"
				style={{ top: `${calculateTickY(-geometry.step / 2, geometry)}%` }}
			>
				Out
			</span>
		);
	}
	return labels;
}

// A faint gridline at every tick but zero; the zero line is drawn over the bars on its own
function buildGridlines(geometry: ChartGeometry) {
	const gridlines: ReactNode[] = [];
	for (const tick of geometry.ticks) {
		if (tick === 0) continue;
		const y = calculateTickY(tick, geometry);
		gridlines.push(
			<line
				key={`gridline-${tick}`}
				className="gridline"
				x1={0}
				x2={100}
				y1={y}
				y2={y}
				vectorEffect="non-scaling-stroke"
			/>
		);
	}
	return gridlines;
}

// Two bars per bucket from the zero line: money in up, money out down. A zero draws nothing.
function buildBars(
	buckets: BucketTotal[],
	geometry: ChartGeometry,
	selectedBucket: string | undefined
) {
	const isDense = buckets.length > DENSE_BUCKET_COUNT;
	const slot = 100 / buckets.length;
	const barWidth = chooseBarWidth(slot, isDense);
	const bars: ReactNode[] = [];
	for (const [index, bucket] of buckets.entries()) {
		const x = index * slot + (slot - barWidth) / 2;
		const isDimmed =
			selectedBucket !== undefined && bucket.bucket !== selectedBucket;
		if (bucket.moneyInMinor > 0) {
			const height = calculateBarHeight(bucket.moneyInMinor, geometry);
			bars.push(
				<rect
					key={`${bucket.bucket}-in`}
					className={buildBarClassName("in", isDimmed)}
					x={x}
					y={geometry.zeroY - height}
					width={barWidth}
					height={height}
				/>
			);
		}
		if (bucket.moneyOutMinor > 0) {
			bars.push(
				<rect
					key={`${bucket.bucket}-out`}
					className={buildBarClassName("out", isDimmed)}
					x={x}
					y={geometry.zeroY}
					width={barWidth}
					height={calculateBarHeight(bucket.moneyOutMinor, geometry)}
				/>
			);
		}
	}
	return bars;
}

// The tooltip's lines, read by sight only: the button's own name says the same
function BucketTooltip({
	bucket,
	currency,
	className
}: {
	bucket: BucketTotal;
	currency: string;
	className: string;
}) {
	return (
		<span className={className} aria-hidden="true">
			<span className="tooltip-title">
				{formatBucket(bucket.bucket, "long")}
			</span>
			<span className="tooltip-row">
				In
				<span className="amount">
					{formatMoney(bucket.moneyInMinor, currency)}
				</span>
			</span>
			<span className="tooltip-row">
				Out
				<span className="amount">
					{formatMoney(bucket.moneyOutMinor, currency)}
				</span>
			</span>
		</span>
	);
}

// One transparent button per bucket over the plot and its label row; pressing one selects
// the bucket, and pressing it again lets it go
function buildColumns(
	buckets: BucketTotal[],
	interval: Interval,
	currency: string,
	selectedBucket: string | undefined,
	onSelect: (bucket: string) => void
) {
	const columns: ReactNode[] = [];
	for (const [index, bucket] of buckets.entries()) {
		const rank = chooseBucketLabelRank(bucket.bucket, interval, index);
		columns.push(
			<button
				key={bucket.bucket}
				type="button"
				className="column"
				aria-pressed={bucket.bucket === selectedBucket}
				aria-label={describeBucket(bucket, currency)}
				onClick={() => onSelect(bucket.bucket)}
			>
				<span className={buildLabelClassName(rank)} aria-hidden="true">
					{rank === undefined ? "" : formatBucket(bucket.bucket, "short")}
				</span>
				<BucketTooltip
					bucket={bucket}
					currency={currency}
					className={buildTooltipClassName(index, buckets.length)}
				/>
			</button>
		);
	}
	return columns;
}

// Money in above one zero line and money out below it, a bucket per column. The marks are a
// stretched svg; the labels and the buttons are HTML laid over it, so text never stretches.
export function MoneyFlowChart({
	buckets,
	interval,
	currency,
	selectedBucket,
	onSelect
}: {
	buckets: BucketTotal[];
	interval: Interval;
	currency: string;
	selectedBucket: string | undefined;
	onSelect: (bucket: string) => void;
}) {
	const geometry = buildChartGeometry(buckets);
	const isDense = buckets.length > DENSE_BUCKET_COUNT;
	return (
		<div className={isDense ? "money-flow chart-dense" : "money-flow"}>
			<div className="axis" aria-hidden="true">
				{buildAxisLabels(geometry)}
			</div>
			<div className="plot">
				<svg
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{buildGridlines(geometry)}
					{buildBars(buckets, geometry, selectedBucket)}
					<line
						className="zero-line"
						x1={0}
						x2={100}
						y1={geometry.zeroY}
						y2={geometry.zeroY}
						vectorEffect="non-scaling-stroke"
					/>
				</svg>
				<fieldset className="columns" aria-label={`Buckets by ${interval}`}>
					{buildColumns(buckets, interval, currency, selectedBucket, onSelect)}
				</fieldset>
			</div>
		</div>
	);
}
