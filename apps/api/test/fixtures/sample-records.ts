import {
	CATEGORY_IDS,
	type TransactionFixture
} from "../integration/helpers/seed.ts";

// A hand-computed corpus for the summary. Every row is here for a reason, given
// in its comment. Every expected number below was worked out by hand from these
// rows, never by code: a test that computes its expectations repeats the code's
// mistakes. If you add a row, work out every expected group again by hand.

export const CORPUS_USER_ID = "00000000-0000-4000-8000-00000000000a";
export const OTHER_USER_ID = "00000000-0000-4000-8000-00000000000b";

/** July and August 2026; toDateTime is exclusive */
export const CORPUS_WINDOW =
	"fromDateTime=2026-07-01T00:00:00Z&toDateTime=2026-09-01T00:00:00Z";

function buildRow(
	occurredAt: string,
	category: keyof typeof CATEGORY_IDS,
	creditDebitIndicator: "credit" | "debit",
	amountMinor: number,
	status: TransactionFixture["status"] = "completed",
	userId = CORPUS_USER_ID
) {
	return {
		userId,
		occurredAt,
		categoryId: CATEGORY_IDS[category],
		creditDebitIndicator,
		amountMinor,
		status
	};
}

export const CORPUS_ROWS: TransactionFixture[] = [
	// 0: the window's first instant, so fromDateTime is inclusive
	buildRow("2026-07-01T00:00:00.000000Z", "groceries", "debit", 10000),
	// 1: a second groceries debit in July
	buildRow("2026-07-15T12:00:00.000000Z", "groceries", "debit", 2500),
	// 2
	buildRow("2026-07-20T08:00:00.000000Z", "dining", "debit", 4000),
	// 3: money in
	buildRow("2026-07-25T09:00:00.000000Z", "income", "credit", 500000),
	// 4: July's last microsecond, so it lands in July's bucket
	buildRow("2026-07-31T23:59:59.999999Z", "transport", "debit", 1500),
	// 5: August's first instant, so it lands in August's bucket
	buildRow("2026-08-01T00:00:00.000000Z", "transport", "debit", 2000),
	// 6
	buildRow("2026-08-05T18:30:00.000000Z", "dining", "debit", 3500),
	// 7: a refund, money in under a spending category
	buildRow("2026-08-12T10:00:00.000000Z", "groceries", "credit", 1200),
	// 8
	buildRow("2026-08-25T09:00:00.000000Z", "income", "credit", 500000),
	// 9: the last microsecond before toDateTime
	buildRow("2026-08-31T23:59:59.999999Z", "groceries", "debit", 3000),

	// Never counted:
	// 10, 11, 12: listed, but only completed rows count toward the summary
	buildRow(
		"2026-07-10T10:00:00.000000Z",
		"groceries",
		"debit",
		99900,
		"pending"
	),
	buildRow("2026-07-11T10:00:00.000000Z", "dining", "debit", 88800, "reversed"),
	buildRow(
		"2026-08-20T10:00:00.000000Z",
		"groceries",
		"debit",
		44400,
		"failed"
	),
	// 13: exactly toDateTime, which is exclusive
	buildRow("2026-09-01T00:00:00.000000Z", "groceries", "debit", 77700),
	// 14: a microsecond before fromDateTime
	buildRow("2026-06-30T23:59:59.999999Z", "groceries", "debit", 66600),
	// 15: another user's row inside the window
	buildRow(
		"2026-07-15T12:00:00.000000Z",
		"groceries",
		"debit",
		55500,
		"completed",
		OTHER_USER_ID
	)
];

/** One summary group, compact; the test reshapes it into the response's form */
export interface ExpectedGroup {
	category: string;
	month?: string;
	count: number;
	debitCount: number;
	debitTotal: number;
	creditCount: number;
	creditTotal: number;
	/** creditTotal − debitTotal */
	net: number;
}

// Rows 0–9 by category, biggest debit total first, then category slug
export const EXPECTED_BY_CATEGORY: ExpectedGroup[] = [
	// rows 0, 1, 9 debit 10000 + 2500 + 3000; row 7 credit 1200
	{
		category: "groceries",
		count: 4,
		debitCount: 3,
		debitTotal: 15500,
		creditCount: 1,
		creditTotal: 1200,
		net: -14300
	},
	// rows 2, 6: 4000 + 3500
	{
		category: "dining",
		count: 2,
		debitCount: 2,
		debitTotal: 7500,
		creditCount: 0,
		creditTotal: 0,
		net: -7500
	},
	// rows 4, 5: 1500 + 2000
	{
		category: "transport",
		count: 2,
		debitCount: 2,
		debitTotal: 3500,
		creditCount: 0,
		creditTotal: 0,
		net: -3500
	},
	// rows 3, 8
	{
		category: "income",
		count: 2,
		debitCount: 0,
		debitTotal: 0,
		creditCount: 2,
		creditTotal: 1000000,
		net: 1000000
	}
];

// Rows 0–9 by month: buckets in time order, then as above within a bucket
export const EXPECTED_BY_MONTH: ExpectedGroup[] = [
	// rows 0, 1
	{
		month: "2026-07",
		category: "groceries",
		count: 2,
		debitCount: 2,
		debitTotal: 12500,
		creditCount: 0,
		creditTotal: 0,
		net: -12500
	},
	// row 2
	{
		month: "2026-07",
		category: "dining",
		count: 1,
		debitCount: 1,
		debitTotal: 4000,
		creditCount: 0,
		creditTotal: 0,
		net: -4000
	},
	// row 4
	{
		month: "2026-07",
		category: "transport",
		count: 1,
		debitCount: 1,
		debitTotal: 1500,
		creditCount: 0,
		creditTotal: 0,
		net: -1500
	},
	// row 3
	{
		month: "2026-07",
		category: "income",
		count: 1,
		debitCount: 0,
		debitTotal: 0,
		creditCount: 1,
		creditTotal: 500000,
		net: 500000
	},
	// row 6
	{
		month: "2026-08",
		category: "dining",
		count: 1,
		debitCount: 1,
		debitTotal: 3500,
		creditCount: 0,
		creditTotal: 0,
		net: -3500
	},
	// row 9 debit, row 7 credit
	{
		month: "2026-08",
		category: "groceries",
		count: 2,
		debitCount: 1,
		debitTotal: 3000,
		creditCount: 1,
		creditTotal: 1200,
		net: -1800
	},
	// row 5
	{
		month: "2026-08",
		category: "transport",
		count: 1,
		debitCount: 1,
		debitTotal: 2000,
		creditCount: 0,
		creditTotal: 0,
		net: -2000
	},
	// row 8
	{
		month: "2026-08",
		category: "income",
		count: 1,
		debitCount: 0,
		debitTotal: 0,
		creditCount: 1,
		creditTotal: 500000,
		net: 500000
	}
];

// The same rows with transport remapped to retail, and row 4 (transport,
// so the remap covers it too) overridden to dining. The override wins over the
// remap. Overrides move rows between groups; they never change a total.
export const EXPECTED_BY_CATEGORY_WITH_OVERRIDES: ExpectedGroup[] = [
	// rows 0, 1, 9 debit 10000 + 2500 + 3000; row 7 credit 1200; untouched
	{
		category: "groceries",
		count: 4,
		debitCount: 3,
		debitTotal: 15500,
		creditCount: 1,
		creditTotal: 1200,
		net: -14300
	},
	// rows 2, 6 and 4 (overridden): 4000 + 3500 + 1500
	{
		category: "dining",
		count: 3,
		debitCount: 3,
		debitTotal: 9000,
		creditCount: 0,
		creditTotal: 0,
		net: -9000
	},
	// row 5, remapped from transport
	{
		category: "retail",
		count: 1,
		debitCount: 1,
		debitTotal: 2000,
		creditCount: 0,
		creditTotal: 0,
		net: -2000
	},
	// rows 3, 8; no transport group is left
	{
		category: "income",
		count: 2,
		debitCount: 0,
		debitTotal: 0,
		creditCount: 2,
		creditTotal: 1000000,
		net: 1000000
	}
];

// Rows 0–9: debits 0, 1, 2, 4, 5, 6, 9; credits 3, 7, 8
export const EXPECTED_TOTALS = {
	transactionCount: 10,
	debitCount: 7,
	// 10000 + 2500 + 4000 + 1500 + 2000 + 3500 + 3000
	debitTotal: 26500,
	creditCount: 3,
	// 500000 + 1200 + 500000
	creditTotal: 1001200,
	net: 974700
};
