import { PeriodControl } from "@/components/PeriodControl.tsx";
import { buildFilterHref } from "@/lib/transaction-query.ts";

// A period link keeps every other filter in the URL; picking a period drops the chosen bucket
// and bucket size, which belong to the old period's chart
function createPeriodHrefBuilder(searchParams: URLSearchParams) {
	return function buildPeriodHref(months: number) {
		return buildFilterHref(searchParams, "months", String(months));
	};
}

// The screen's heading, the one-line finding under it, and the period control at the row's
// far end. The finding's line is kept while it is read, so the blocks below do not move
// when it lands.
export function TitleRow({
	months,
	finding,
	searchParams
}: {
	months: number;
	finding: string | undefined;
	searchParams: URLSearchParams;
}) {
	const buildPeriodHref = createPeriodHrefBuilder(searchParams);
	return (
		<div className="title-row">
			<div>
				<h1>Spending</h1>
				<p className="finding">{finding}</p>
			</div>
			<PeriodControl months={months} buildHref={buildPeriodHref} />
		</div>
	);
}
