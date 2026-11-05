import type { ReactNode } from "react";

// Loading placeholders: the final layout, its labels and headers shown at once, with each
// value a flat grey bar as tall as the line it stands for. Each block's placeholder is built
// from the same elements and classes as what replaces it, so the page does not move when the
// read lands. There is no pulse or shimmer. Each root says it is busy.

// One table row in the real table's cells: the date, the description over its type, the
// category's dot and label, the amount, the status, and the round menu button
function buildSkeletonRow(key: string) {
	return (
		<tr key={key}>
			<td className="cell-date">
				<span className="skeleton-text skeleton-width-date" />
			</td>
			<td className="cell-description">
				<span className="skeleton-description">
					<span className="skeleton-text skeleton-width-description" />
					<span className="skeleton-text skeleton-width-type description-type" />
				</span>
			</td>
			<td className="cell-category">
				<span className="category-cell">
					<span className="skeleton-dot" />
					<span className="skeleton-text skeleton-width-label" />
				</span>
			</td>
			<td className="cell-amount">
				<span className="skeleton-text skeleton-width-amount" />
			</td>
			<td className="cell-status">
				<span className="skeleton-text skeleton-width-status" />
			</td>
			<td className="cell-actions">
				<span className="skeleton-kebab" />
			</td>
		</tr>
	);
}

// The transaction table with its header, and rows at the real rows' pitch
export function SkeletonRows({ rows }: { rows: number }) {
	const elements: ReactNode[] = [];
	for (let index = 0; index < rows; index += 1) {
		elements.push(buildSkeletonRow(`row-${index}`));
	}
	return (
		<div role="status" aria-busy="true" aria-label="Loading transactions">
			<table className="transactions skeleton-table" aria-hidden="true">
				<thead>
					<tr>
						<th scope="col">Date</th>
						<th scope="col">Description</th>
						<th scope="col">Category</th>
						<th scope="col" className="cell-amount">
							Amount
						</th>
						<th scope="col">Status</th>
						<th scope="col" className="cell-actions">
							<span className="visually-hidden">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>{elements}</tbody>
			</table>
		</div>
	);
}

// The ring as a grey track at the ring's size with bars for the total and its caption in the
// centre, then the two tiles with their labels and bars for their values, and the count
// sentence as a bar
export function SkeletonRing() {
	return (
		<div role="status" aria-busy="true" aria-label="Loading the spending">
			<div className="ring-wrap">
				<div className="ring-skeleton" />
				<div className="ring-centre">
					<p className="ring-total">
						<span className="skeleton-text skeleton-width-total" />
					</p>
					<p className="ring-caption">
						<span className="skeleton-text skeleton-width-caption" />
					</p>
				</div>
			</div>
			<dl className="period-figures">
				<div className="period-figure">
					<dt>Money in</dt>
					<dd>
						<span className="skeleton-text skeleton-width-value" />
					</dd>
				</div>
				<div className="period-figure">
					<dt>Net</dt>
					<dd>
						<span className="skeleton-text skeleton-width-value" />
					</dd>
				</div>
			</dl>
			<p className="period-count">
				<span className="skeleton-text skeleton-width-count" />
			</p>
		</div>
	);
}

// The spending card's rows at their real pitch: a grey circle where the badge goes, a bar for
// the label and one for the amount, and on the Category tab a second circle where the row's
// menu goes, so the amounts do not move when the rows land. Eight fill two columns of a wide
// card's first screen; the Type tab asks for its four, with no menus, so the card does not
// change height when the types land.
export function SkeletonCategoryRows({
	rowCount = 8,
	hasMenus = true
}: {
	rowCount?: number;
	hasMenus?: boolean;
}) {
	const rows: ReactNode[] = [];
	for (let index = 0; index < rowCount; index += 1) {
		rows.push(
			<li
				key={`row-${index}`}
				className={
					hasMenus
						? "skeleton-category-row skeleton-category-row-with-menu"
						: "skeleton-category-row"
				}
			>
				<span className="skeleton-badge" />
				<span className="skeleton-text skeleton-width-label" />
				<span className="skeleton-text skeleton-width-amount" />
				{hasMenus ? <span className="skeleton-kebab" /> : null}
			</li>
		);
	}
	return (
		<ul
			className="category-rows skeleton-category-rows"
			role="status"
			aria-busy="true"
			aria-label="Loading the categories"
		>
			{rows}
		</ul>
	);
}

// The whole spending card's body before the screen can read the URL: the ring column, then
// the list's head (passed in, the loaded card's own) over the rows
export function SkeletonSpending({ head }: { head: ReactNode }) {
	return (
		<>
			<div className="hero-ring">
				<SkeletonRing />
			</div>
			<div className="hero-categories">
				{head}
				<SkeletonCategoryRows />
			</div>
		</>
	);
}

// A fixed silhouette of a month chart, as percentages of the plot's height
const SKELETON_COLUMN_HEIGHTS = [
	33, 17, 68, 19, 76, 3, 48, 18, 100, 19, 20, 74
];

// The chart's gutter and plot box at the plot's own height, with the label row beneath it
export function SkeletonChart() {
	const columns: ReactNode[] = [];
	for (const [index, height] of SKELETON_COLUMN_HEIGHTS.entries()) {
		columns.push(
			<span
				key={`column-${index}`}
				className="skeleton-column"
				style={{ height: `${height}%` }}
			/>
		);
	}
	return (
		<div
			className="money-flow skeleton-money-flow"
			role="status"
			aria-busy="true"
			aria-label="Loading the chart"
		>
			<div className="axis" />
			<div className="plot">{columns}</div>
		</div>
	);
}
