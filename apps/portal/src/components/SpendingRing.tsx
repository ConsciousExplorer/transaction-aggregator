import type { ReactNode } from "react";
import { buildHueClassName } from "@/lib/category-style.ts";
import { formatMoney, formatWholeMoney, splitAtCents } from "@/lib/money.ts";
import { buildRingArcs, type RingSegment } from "@/lib/ring.ts";

// Read aloud, the ring is the list of what it shows: "Money out by category: Transfers
// R 145 018,11, Transport R 17 863,03."
function describeRing(segments: RingSegment[], currency: string) {
	if (segments.length === 0) return "No money out in this period.";
	const parts = [];
	for (const segment of segments) {
		parts.push(
			`${segment.label} ${formatMoney(segment.amountMinor, currency)}`
		);
	}
	return `Money out by category: ${parts.join(", ")}.`;
}

// One path per arc, coloured through its hue class; the full circle's two halves share a
// segment, so a path is keyed by its place
function buildArcPaths(
	segments: RingSegment[],
	currency: string,
	diameter: number,
	strokeWidth: number
) {
	const arcs = buildRingArcs(segments, diameter, strokeWidth);
	const paths: ReactNode[] = [];
	for (const [index, arc] of arcs.entries()) {
		const segment = arc.segment;
		paths.push(
			<path
				key={`arc-${index}`}
				className={buildHueClassName(segment.hue)}
				d={arc.d}
				fill="none"
				strokeWidth={strokeWidth}
			>
				<title>
					{`${segment.label}: ${formatMoney(segment.amountMinor, currency)}, ${segment.share}%`}
				</title>
			</path>
		);
	}
	return paths;
}

// Money out by category as a ring, the total in its centre. The svg draws at a fixed size and
// the stylesheet scales it to --ring-size, so a phone's smaller ring needs no other props.
// A period with no money out keeps the ring's shape as an empty grey track.
export function SpendingRing({
	segments,
	totalMinor,
	currency,
	caption,
	monthlyAverageMinor,
	diameter = 260,
	strokeWidth = 20
}: {
	segments: RingSegment[];
	totalMinor: number;
	currency: string;
	// The window the money out covers, such as "last 12 months"
	caption: string;
	// Shown only over several months with no bucket selected
	monthlyAverageMinor?: number;
	diameter?: number;
	strokeWidth?: number;
}) {
	const total = splitAtCents(formatMoney(totalMinor, currency));
	const centre = diameter / 2;
	return (
		<div className="ring-wrap">
			<svg
				className="ring"
				viewBox={`0 0 ${diameter} ${diameter}`}
				role="img"
				aria-label={describeRing(segments, currency)}
			>
				{segments.length === 0 ? (
					<circle
						className="ring-empty"
						cx={centre}
						cy={centre}
						r={centre - strokeWidth / 2}
						fill="none"
						strokeWidth={strokeWidth}
					/>
				) : (
					buildArcPaths(segments, currency, diameter, strokeWidth)
				)}
			</svg>
			<div className="ring-centre">
				<p className="ring-total">
					{total.whole}
					<span className="cents">{total.cents}</span>
				</p>
				<p className="ring-caption">money out · {caption}</p>
				{monthlyAverageMinor === undefined ? null : (
					<p className="ring-average">
						{formatWholeMoney(monthlyAverageMinor, currency)} a month
					</p>
				)}
			</div>
		</div>
	);
}
