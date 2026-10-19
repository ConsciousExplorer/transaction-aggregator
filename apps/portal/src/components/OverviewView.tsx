"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import { calculateBarWidth } from "@/lib/bars.ts";
import {
	describeError,
	type PortalRequestError,
	readJson
} from "@/lib/bff-client.ts";
import { formatMoney, formatSignedMoney } from "@/lib/money.ts";
import { buildPeriod, PERIOD_MONTHS, readPeriodMonths } from "@/lib/periods.ts";
import {
	buildCategoryLabels,
	buildCategorySpending,
	buildMonthlyTotals,
	type CategorySpending,
	fillMissingMonths,
	formatMonth,
	type MonthlyTotal
} from "@/lib/summary.ts";
import { buildMonthHref, buildSpendingHref } from "@/lib/transaction-query.ts";
import type { Category, Summary } from "@/lib/types.ts";

type Overview = {
	totals: Summary["totals"];
	spending: CategorySpending[];
	monthly: MonthlyTotal[];
};

type OverviewState =
	| { status: "loading" }
	| { status: "ready"; overview: Overview }
	| { status: "failed"; error: PortalRequestError };

// Three BFF calls in parallel: the labels, the window by category, and the window by month
async function loadOverview(months: number, signal: AbortSignal) {
	const period = buildPeriod(months, new Date());
	const periodQuery = new URLSearchParams(period).toString();
	const [categoryList, byCategory, byMonth] = await Promise.all([
		readJson("/bff/categories", signal) as Promise<{ categories: Category[] }>,
		readJson(`/bff/summary?${periodQuery}`, signal) as Promise<Summary>,
		readJson(
			`/bff/summary?${periodQuery}&interval=month`,
			signal
		) as Promise<Summary>
	]);
	const labels = buildCategoryLabels(categoryList.categories);
	return {
		totals: byCategory.totals,
		spending: buildCategorySpending(byCategory.data, labels),
		monthly: fillMissingMonths(
			buildMonthlyTotals(byMonth.data),
			period.fromDateTime,
			period.toDateTime
		)
	};
}

function describePeriod(months: number) {
	return months === 1 ? "1 month" : `${months} months`;
}

function PeriodLinks({ months }: { months: number }) {
	const links: ReactNode[] = [];
	for (const option of PERIOD_MONTHS) {
		links.push(
			<Link
				key={option}
				href={`/overview?months=${option}`}
				className="segment"
				aria-current={option === months ? "page" : undefined}
			>
				{describePeriod(option)}
			</Link>
		);
	}
	return (
		<nav className="segments" aria-label="Period">
			{links}
		</nav>
	);
}

// The page's one bold element: where the money went, as a single split bar
function BalanceBar({
	totals,
	months
}: {
	totals: Summary["totals"];
	months: number;
}) {
	const moneyIn = totals.credit.total;
	const moneyOut = totals.debit.total;
	const whole = moneyIn.amountMinor + moneyOut.amountMinor;
	const inShare = whole > 0 ? (moneyIn.amountMinor / whole) * 100 : 0;
	const net = totals.netAmount;
	const netDirection = net.amountMinor < 0 ? "debit" : "credit";

	return (
		<section className="balance" aria-labelledby="balance-heading">
			<h2 id="balance-heading" className="visually-hidden">
				Money in and out
			</h2>
			<div className="balance-figures">
				<div className="balance-figure">
					<span className="legend-item">
						<span className="swatch swatch-in" aria-hidden="true" />
						Money in
					</span>
					<span className="balance-amount amount">
						{formatMoney(moneyIn.amountMinor, moneyIn.currency)}
					</span>
					<span className="muted small">
						{totals.credit.count} transactions
					</span>
				</div>
				<div className="balance-figure balance-figure-out">
					<span className="legend-item">
						<span className="swatch swatch-out" aria-hidden="true" />
						Money out
					</span>
					<span className="balance-amount amount">
						{formatMoney(moneyOut.amountMinor, moneyOut.currency)}
					</span>
					<span className="muted small">{totals.debit.count} transactions</span>
				</div>
			</div>
			<div className="balance-bar" aria-hidden="true">
				{moneyIn.amountMinor > 0 ? (
					<span className="balance-in" style={{ flexBasis: `${inShare}%` }} />
				) : null}
				{moneyOut.amountMinor > 0 ? (
					<span
						className="balance-out"
						style={{ flexBasis: `${100 - inShare}%` }}
					/>
				) : null}
			</div>
			<p className="balance-net">
				Net{" "}
				<strong className="amount">
					{formatSignedMoney(
						{ amountMinor: Math.abs(net.amountMinor), currency: net.currency },
						netDirection
					)}
				</strong>{" "}
				over the last {describePeriod(months)}. These figures count completed
				transactions; pending, failed and reversed ones are in the list.
			</p>
		</section>
	);
}

function SpendingList({
	spending,
	months
}: {
	spending: CategorySpending[];
	months: number;
}) {
	if (spending.length === 0)
		return <p className="empty">No spending in this period.</p>;
	const largest = spending[0]?.amountMinor ?? 0;
	const rows: ReactNode[] = [];
	for (const item of spending) {
		rows.push(
			<li key={item.category}>
				<Link
					className="spending-row"
					href={buildSpendingHref(item.category, months)}
				>
					<span className="spending-label">
						{item.label}
						<span className="muted small">
							{item.count} {item.count === 1 ? "transaction" : "transactions"}
						</span>
					</span>
					<span className="spending-track" aria-hidden="true">
						<span
							className="spending-bar"
							style={{
								width: `${calculateBarWidth(item.amountMinor, largest)}%`
							}}
						/>
					</span>
					<span className="amount">{formatMoney(item.amountMinor, "ZAR")}</span>
				</Link>
			</li>
		);
	}
	return <ul className="spending">{rows}</ul>;
}

function MonthlyChart({ monthly }: { monthly: MonthlyTotal[] }) {
	let largest = 0;
	for (const total of monthly) {
		largest = Math.max(largest, total.moneyInMinor, total.moneyOutMinor);
	}
	if (largest === 0)
		return <p className="empty">No transactions in this period.</p>;

	const columns: ReactNode[] = [];
	for (const total of monthly) {
		const longMonth = formatMonth(total.month, "long");
		const moneyIn = formatMoney(total.moneyInMinor, "ZAR");
		const moneyOut = formatMoney(total.moneyOutMinor, "ZAR");
		// Each column is a link to that month's transactions, so it takes focus, and keyboard
		// users get the same tooltip as hover
		columns.push(
			<Link
				key={total.month}
				href={buildMonthHref(total.month)}
				className="month"
				aria-label={`${longMonth}: money in ${moneyIn}, money out ${moneyOut}. Show this month's transactions`}
			>
				<div className="month-bars" aria-hidden="true">
					<span
						className="month-bar month-bar-in"
						style={{
							height: `${calculateBarWidth(total.moneyInMinor, largest)}%`
						}}
					/>
					<span
						className="month-bar month-bar-out"
						style={{
							height: `${calculateBarWidth(total.moneyOutMinor, largest)}%`
						}}
					/>
				</div>
				<span className="month-label" aria-hidden="true">
					{formatMonth(total.month, "short")}
				</span>
				<div className="tooltip" aria-hidden="true">
					<strong>{longMonth}</strong>
					<span className="legend-item">
						<span className="swatch swatch-in" />
						In <span className="amount">{moneyIn}</span>
					</span>
					<span className="legend-item">
						<span className="swatch swatch-out" />
						Out <span className="amount">{moneyOut}</span>
					</span>
				</div>
			</Link>
		);
	}

	return (
		<figure className="monthly">
			<figcaption className="legend">
				<span className="legend-item">
					<span className="swatch swatch-in" aria-hidden="true" />
					Money in
				</span>
				<span className="legend-item">
					<span className="swatch swatch-out" aria-hidden="true" />
					Money out
				</span>
			</figcaption>
			<div className="months">{columns}</div>
		</figure>
	);
}

function OverviewBody({
	state,
	months
}: {
	state: OverviewState;
	months: number;
}) {
	if (state.status === "loading")
		return <p className="loading">Loading your overview…</p>;
	if (state.status === "failed") return <ErrorNotice error={state.error} />;
	const { overview } = state;
	if (overview.totals.transactionCount === 0) {
		return (
			<p className="empty">
				No transactions in the last {describePeriod(months)}. Try a longer
				period.
			</p>
		);
	}
	return (
		<>
			<BalanceBar totals={overview.totals} months={months} />
			<div className="overview-grid">
				<section className="panel" aria-labelledby="spending-heading">
					<h2 id="spending-heading">Spending by category</h2>
					<SpendingList spending={overview.spending} months={months} />
				</section>
				<section className="panel" aria-labelledby="monthly-heading">
					<h2 id="monthly-heading">Money in and out by month</h2>
					<MonthlyChart monthly={overview.monthly} />
				</section>
			</div>
		</>
	);
}

export function OverviewView() {
	const searchParams = useSearchParams();
	const months = readPeriodMonths(searchParams.get("months"));
	const [state, setState] = useState<OverviewState>({ status: "loading" });

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading" });
		loadOverview(months, controller.signal).then(
			(overview) => setState({ status: "ready", overview }),
			(error) => {
				if (!controller.signal.aborted)
					setState({ status: "failed", error: describeError(error) });
			}
		);
		return () => controller.abort();
	}, [months]);

	return (
		<>
			<div className="page-heading">
				<h1>Overview</h1>
				<PeriodLinks months={months} />
			</div>
			<OverviewBody state={state} months={months} />
		</>
	);
}
