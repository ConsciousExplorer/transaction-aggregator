import { type CategoryFigures, readCategoryFigures } from "./categories.ts";
import { type CategoryHue, readCategoryHue } from "./category-style.ts";
import type { Category } from "./types.ts";

// The spending ring: money out by category as arcs of one circle, the largest first,
// clockwise from the top. The arithmetic is here, apart from the drawing, so it can be tested.

export type RingSegment = {
	label: string;
	// Undefined for Other, which stands for several categories
	slug: string | undefined;
	amountMinor: number;
	share: number;
	hue: CategoryHue;
};

type RingArc = { d: string; segment: RingSegment };

// Seven hues can be told apart around one ring; every category past the seventh joins Other
const RING_SEGMENT_LIMIT = 7;

// Each segment stops this many pixels short of the next, measured along the stroke's middle
const SEAM_WIDTH = 3;

// A segment too small to show past its seams is still drawn, as a hairline this many
// radians long, so every category the ring names can be found on it
const MINIMUM_SWEEP = 0.004;

const FULL_TURN = 2 * Math.PI;

// The top of the circle, where the first segment starts
const START_ANGLE = -Math.PI / 2;

export function calculateShare(amountMinor: number, totalMinor: number) {
	if (totalMinor === 0) return 0;
	return Math.round((amountMinor / totalMinor) * 100);
}

// Over several months with no bucket picked, the ring also says what went out in a month: the
// total over the months, in whole minor units, which the ring prints as whole rand. One month
// is its own average, and a bucket is not a run of months, so neither has one.
export function calculateMonthlyAverage(
	totalMinor: number,
	months: number,
	selectedBucket: string | undefined
) {
	if (months <= 1 || selectedBucket !== undefined) return undefined;
	return Math.round(totalMinor / months);
}

// A category's money out per transaction; with no transactions there is no average
export function calculateAverageMinor(amountMinor: number, count: number) {
	if (count === 0) return undefined;
	return Math.round(amountMinor / count);
}

// The categories that sent money out, largest first. A stable sort keeps the caller's order
// between equal amounts.
function listSpendingCategories(
	ranked: Category[],
	figures: Record<string, CategoryFigures>
) {
	const spending = [];
	for (const category of ranked) {
		const moneyOutMinor = readCategoryFigures(
			figures,
			category.category
		).moneyOutMinor;
		if (moneyOutMinor > 0) spending.push({ category, moneyOutMinor });
	}
	spending.sort((first, second) => second.moneyOutMinor - first.moneyOutMinor);
	return spending;
}

// The seven largest categories as themselves, then Other for the rest. A period with no
// money out has no segments.
export function buildRingSegments(
	ranked: Category[],
	figures: Record<string, CategoryFigures>
) {
	const spending = listSpendingCategories(ranked, figures);
	let totalMinor = 0;
	for (const entry of spending) {
		totalMinor += entry.moneyOutMinor;
	}
	const segments: RingSegment[] = [];
	if (totalMinor === 0) return segments;

	let otherMinor = 0;
	for (const [index, entry] of spending.entries()) {
		if (index >= RING_SEGMENT_LIMIT) {
			otherMinor += entry.moneyOutMinor;
			continue;
		}
		segments.push({
			label: entry.category.label,
			slug: entry.category.category,
			amountMinor: entry.moneyOutMinor,
			share: calculateShare(entry.moneyOutMinor, totalMinor),
			hue: readCategoryHue(entry.category.category)
		});
	}
	if (otherMinor > 0) {
		segments.push({
			label: "Other",
			slug: undefined,
			amountMinor: otherMinor,
			share: calculateShare(otherMinor, totalMinor),
			hue: "neutral"
		});
	}
	return segments;
}

function formatCoordinate(value: number) {
	return value.toFixed(2);
}

// SVG path data for a clockwise arc of the circle from one angle to another, in radians
// measured clockwise from three o'clock
function buildArcPath(
	centre: number,
	radius: number,
	startAngle: number,
	endAngle: number
) {
	const startX = formatCoordinate(centre + radius * Math.cos(startAngle));
	const startY = formatCoordinate(centre + radius * Math.sin(startAngle));
	const endX = formatCoordinate(centre + radius * Math.cos(endAngle));
	const endY = formatCoordinate(centre + radius * Math.sin(endAngle));
	const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
	const size = formatCoordinate(radius);
	return `M${startX} ${startY}A${size} ${size} 0 ${largeArc} 1 ${endX} ${endY}`;
}

// The arcs that draw the segments on a ring of this diameter and stroke width. One segment
// holding all the money is a whole circle, which a single arc cannot draw (its ends would
// meet), so it is two half arcs with no seam between them.
export function buildRingArcs(
	segments: RingSegment[],
	diameter: number,
	strokeWidth: number
) {
	const centre = diameter / 2;
	const radius = centre - strokeWidth / 2;
	const arcs: RingArc[] = [];

	const onlySegment = segments.length === 1 ? segments[0] : undefined;
	if (onlySegment !== undefined) {
		const bottomAngle = START_ANGLE + Math.PI;
		arcs.push({
			d: buildArcPath(centre, radius, START_ANGLE, bottomAngle),
			segment: onlySegment
		});
		arcs.push({
			d: buildArcPath(centre, radius, bottomAngle, START_ANGLE + FULL_TURN),
			segment: onlySegment
		});
		return arcs;
	}

	let totalMinor = 0;
	for (const segment of segments) {
		totalMinor += segment.amountMinor;
	}
	// The seam as an angle: its width along the stroke's middle line over the radius
	const seam = SEAM_WIDTH / radius;
	let angle = START_ANGLE;
	for (const segment of segments) {
		const sweep = (segment.amountMinor / totalMinor) * FULL_TURN;
		const startAngle = angle + seam / 2;
		let endAngle = angle + sweep - seam / 2;
		if (endAngle <= startAngle) endAngle = startAngle + MINIMUM_SWEEP;
		arcs.push({
			d: buildArcPath(centre, radius, startAngle, endAngle),
			segment
		});
		angle += sweep;
	}
	return arcs;
}
