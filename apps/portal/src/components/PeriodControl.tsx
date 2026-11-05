import {
	type SegmentedLink,
	SegmentedLinks
} from "@/components/SegmentedLinks.tsx";
import { describePeriod, PERIOD_MONTHS } from "@/lib/periods.ts";

// The 1 / 3 / 12 months control in the screen's title row. The title row supplies the href
// for each period, since a period link keeps the rest of the URL.
export function PeriodControl({
	months,
	buildHref
}: {
	months: number;
	buildHref: (months: number) => string;
}) {
	const links: SegmentedLink[] = [];
	for (const option of PERIOD_MONTHS) {
		links.push({
			href: buildHref(option),
			label: describePeriod(option),
			current: option === months
		});
	}
	return <SegmentedLinks label="Period" links={links} />;
}
