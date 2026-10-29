// The API's response shapes the portal reads (apps/api/openapi/openapi.json), and the shapes the
// BFF hands the browser. The browser never sees an API URL: links become cursors.

export type Money = { amountMinor: number; currency: string };

export type TransactionType =
	| "card"
	| "eft"
	| "debit_order"
	| "internal_transfer";

export type CreditDebitIndicator = "credit" | "debit";

export type Transaction = {
	transactionId: string;
	occurredAt: string;
	shortDescription: string;
	transactionType: TransactionType;
	creditDebitIndicator: CreditDebitIndicator;
	status: "completed" | "pending" | "reversed" | "failed";
	category: string;
	amount: Money;
};

type Links = { self: string; next?: string; prev?: string };

type TransactionPageMeta = {
	count: number;
	limit: number;
	sort: "-occurredAt" | "occurredAt";
	fromDateTime: string;
	toDateTime: string;
};

export type ApiTransactionPage = {
	data: Transaction[];
	links: Links;
	meta: TransactionPageMeta;
};

export type TransactionPage = {
	transactions: Transaction[];
	meta: TransactionPageMeta;
	nextCursor?: string | undefined;
	previousCursor?: string | undefined;
};

type SummarySide = { count: number; total: Money };

export type SummaryRow = {
	group: { category?: string; day?: string; week?: string; month?: string };
	count: number;
	credit: SummarySide;
	debit: SummarySide;
	netAmount: Money;
};

export type Summary = {
	data: SummaryRow[];
	totals: {
		transactionCount: number;
		credit: SummarySide;
		debit: SummarySide;
		netAmount: Money;
	};
};

export type Category = {
	categoryId: number;
	category: string;
	label: string;
	mappedTo?: {
		categoryId: number;
		category: string;
		label: string;
		updatedAt: string;
	};
};

export type ApiCategoryList = {
	data: Category[];
	links: Links;
	meta: { count: number };
};
