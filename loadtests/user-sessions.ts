import { check, fail, sleep } from "k6";
import { SharedArray } from "k6/data";
import http, { type Response } from "k6/http";
import type { Options, Scenario, Threshold } from "k6/options";

// Randomised user sessions against the transaction API. One iteration is one
// customer's visit to the banking portal: the overview, often the transactions
// page, now and then a recategorise or a category remap. Each step sends the
// calls the portal's BFF makes for that page. Sessions arrive at a fixed rate
// (an open model), so a slow API shows up as latency, not as fewer requests.
// Run it with `make load`; LOAD_PROFILE picks smoke, load or breakpoint.

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:8083";
const TOKEN_URL =
	__ENV.TOKEN_URL ??
	"http://localhost:8086/realms/txn-api/protocol/openid-connect/token";
// The client the portal's BFF calls the API with: tx:read and tx:write
const CLIENT_ID = __ENV.CLIENT_ID ?? "banking-portal";
const CLIENT_SECRET = __ENV.CLIENT_SECRET ?? "banking-portal-secret";
// make up's data stops on its anchor day, so every window ends there. make load
// passes the Makefile's ANCHOR_DATE; the default is for running k6 yourself.
const ANCHOR_DATE = __ENV.ANCHOR_DATE ?? "2026-10-21";
const LOAD_PROFILE = __ENV.LOAD_PROFILE ?? "load";
// A session averages about 5.2 requests (measured), so 10 sessions/s is the
// 50 req/s the 200 ms latency target is set at
const SESSION_RATE = Number(__ENV.SESSION_RATE ?? "10");

// The breakpoint climbs 12 steps of 6 sessions/s (about 30 req/s each, up to
// about 370 req/s), every step a 10 s ramp then a 50 s hold, so each level runs
// long enough to read. 12 minutes keeps every run inside the access token's
// 15-minute life.
const BREAKPOINT_STEPS = 12;
const BREAKPOINT_STEP_RATE = 6;

// The portal's own pickers and filters
const PERIOD_MONTHS = [1, 3, 12];
const PAGE_SIZES = [10, 25, 50];
const FILTER_KINDS = ["category", "transactionType", "creditDebitIndicator"];
const TRANSACTION_TYPES = [
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
];
const CREDIT_DEBIT_INDICATORS = ["credit", "debit"];

// How often a user does each thing, out of the sessions that got that far
const CHANCE_OF_TRANSACTIONS_PAGE = 0.8;
const CHANCE_OF_FILTER = 0.3;
const CHANCE_OF_OLDEST_FIRST = 0.1;
const CHANCE_OF_NEXT_PAGE = 0.4;
const MOST_EXTRA_PAGES = 3;
const CHANCE_OF_OPENING_TRANSACTION = 0.3;
const CHANCE_OF_RECATEGORISING = 0.1;
const CHANCE_OF_RESETTING = 0.3;
const CHANCE_OF_CATEGORIES_PAGE = 0.05;
const CHANCE_OF_UNDOING_REMAP = 0.5;
const SHORTEST_THINK_SECONDS = 1;
const LONGEST_THINK_SECONDS = 5;

// Every request is tagged with its route pattern, the same label the API's
// /metrics uses, so k6's per-route numbers line up with Grafana's
const ROUTES = {
	userCategories: "GET /api/v1/users/:userId/categories",
	summary: "GET /api/v1/users/:userId/summary",
	listTransactions: "GET /api/v1/users/:userId/transactions",
	getTransaction: "GET /api/v1/users/:userId/transactions/:transactionId",
	putTransactionOverride:
		"PUT /api/v1/users/:userId/transaction-overrides/:transactionId",
	deleteTransactionOverride:
		"DELETE /api/v1/users/:userId/transaction-overrides/:transactionId",
	putCategoryOverride:
		"PUT /api/v1/users/:userId/category-overrides/:categoryId",
	deleteCategoryOverride:
		"DELETE /api/v1/users/:userId/category-overrides/:categoryId"
};

// One customer id a line, exported from Postgres by `make load`
const USER_IDS = new SharedArray("user ids", () =>
	open("./users.txt").trim().split("\n")
);

type Window = { fromDateTime: string; toDateTime: string };

type Session = { accessToken: string; userId: string; window: Window };

type UserCategory = { id: number; category: string; label: string };

type TransactionRow = { transactionId: string; category: string };

type TransactionPage = {
	data: TransactionRow[];
	links: { self: string; next?: string };
	meta: { limit: number };
};

// A page as the user sees it: its URL, so it can be read again after a write
type PageView = { url: string; page: TransactionPage };

export const options: Options = {
	scenarios: { sessions: buildScenario(LOAD_PROFILE) },
	thresholds: buildThresholds(LOAD_PROFILE),
	summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
	// The default tags include the full URL, which holds the user and
	// transaction ids: one metric series per URL. The name tag carries the route.
	systemTags: [
		"status",
		"method",
		"name",
		"group",
		"check",
		"error",
		"error_code",
		"scenario",
		"expected_response"
	]
};

// The annotation keeps each executor name a literal instead of widening it to string
function buildScenario(loadProfile: string): Scenario {
	if (loadProfile === "smoke") {
		return { executor: "shared-iterations", vus: 1, iterations: 5 };
	}
	if (loadProfile === "load") {
		return {
			executor: "constant-arrival-rate",
			rate: SESSION_RATE,
			timeUnit: "1s",
			duration: "10m",
			preAllocatedVUs: 150,
			maxVUs: 600
		};
	}
	if (loadProfile === "breakpoint") {
		return {
			executor: "ramping-arrival-rate",
			startRate: 0,
			timeUnit: "1s",
			stages: buildBreakpointStages(),
			preAllocatedVUs: 300,
			maxVUs: 1500
		};
	}
	throw new Error(
		`LOAD_PROFILE must be smoke, load or breakpoint, not "${loadProfile}"`
	);
}

function buildBreakpointStages() {
	const stages = [];
	for (let step = 1; step <= BREAKPOINT_STEPS; step++) {
		const target = step * BREAKPOINT_STEP_RATE;
		stages.push({ target, duration: "10s" });
		stages.push({ target, duration: "50s" });
	}
	return stages;
}

// smoke and load hold the latency target: p95 under 200 ms, under 1% failures.
// The breakpoint expects to cross that line, so it only stops once the API is
// clearly past it; where it crossed is read from the dashboard's time series,
// because a p95 over the whole run lags far behind the rate that broke it.
function buildThresholds(loadProfile: string) {
	const thresholds: Record<string, Threshold[]> = {};
	if (loadProfile === "breakpoint") {
		thresholds.http_req_failed = [
			{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "1m" }
		];
		thresholds.http_req_duration = [
			{ threshold: "p(95)<1000", abortOnFail: true, delayAbortEval: "1m" }
		];
	} else {
		thresholds.http_req_failed = ["rate<0.01"];
		thresholds.http_req_duration = ["p(95)<200"];
		thresholds.checks = ["rate>0.99"];
	}
	// k6 only prints a route's own numbers when a threshold names it
	for (const route of Object.values(ROUTES)) {
		thresholds[`http_req_duration{name:${route}}`] = ["p(95)<200"];
	}
	return thresholds;
}

// One token for the whole run: Keycloak's last 15 minutes, longer than any profile
export function setup() {
	const response = http.post(
		TOKEN_URL,
		{
			grant_type: "client_credentials",
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET
		},
		{ tags: { name: "POST token" } }
	);
	if (response.status !== 200) {
		fail(`the token request answered ${response.status}: ${response.body}`);
	}
	const token = response.json() as { access_token: string };
	return { accessToken: token.access_token };
}

export default function runUserSession(data: { accessToken: string }) {
	const session = {
		accessToken: data.accessToken,
		userId: pickRandom(USER_IDS),
		window: buildWindow(pickRandom(PERIOD_MONTHS))
	};

	// Signing in lands on the overview; if it fails, the portal shows an error page
	const categories = visitOverview(session);
	if (categories === undefined) {
		return;
	}

	if (isChosen(CHANCE_OF_TRANSACTIONS_PAGE)) {
		pauseToThink();
		visitTransactionsPage(session, categories);
	}
	if (isChosen(CHANCE_OF_CATEGORIES_PAGE)) {
		pauseToThink();
		visitCategoriesPage(session);
	}
}

// The overview sends three calls in parallel: the labels, the window by
// category, and the window by month
function visitOverview(session: Session) {
	const summaryUrl = `${buildUserUrl(session)}/summary?${buildQueryString(session.window)}`;
	const responses = http.batch({
		categories: {
			method: "GET",
			url: `${buildUserUrl(session)}/categories`,
			params: buildRequestParams(session, ROUTES.userCategories)
		},
		byCategory: {
			method: "GET",
			url: summaryUrl,
			params: buildRequestParams(session, ROUTES.summary)
		},
		byMonth: {
			method: "GET",
			url: `${summaryUrl}&interval=month`,
			params: buildRequestParams(session, ROUTES.summary)
		}
	});
	checkSummary(responses.byCategory);
	checkSummary(responses.byMonth);
	return readUserCategories(responses.categories);
}

// The page loads the category labels and the first page of the list in
// parallel, then the user may page on, open a transaction, or recategorise one
function visitTransactionsPage(session: Session, categories: UserCategory[]) {
	const limit = pickRandom(PAGE_SIZES);
	const isFiltered = isChosen(CHANCE_OF_FILTER);
	const filter = isFiltered ? chooseFilter(categories) : {};
	const query = buildQueryString({
		...session.window,
		limit: String(limit),
		sort: isChosen(CHANCE_OF_OLDEST_FIRST) ? "occurredAt" : "-occurredAt",
		...filter
	});
	const firstPageUrl = `${buildUserUrl(session)}/transactions?${query}`;
	const responses = http.batch({
		categories: {
			method: "GET",
			url: `${buildUserUrl(session)}/categories`,
			params: buildRequestParams(session, ROUTES.userCategories)
		},
		page: {
			method: "GET",
			url: firstPageUrl,
			params: buildRequestParams(session, ROUTES.listTransactions)
		}
	});
	// Checked for the load it adds; the session keeps the overview's labels
	readUserCategories(responses.categories);
	const firstPage = readTransactionPage(responses.page, limit);
	if (firstPage === undefined) {
		return;
	}

	let view = { url: firstPageUrl, page: firstPage };
	for (let extraPages = 0; extraPages < MOST_EXTRA_PAGES; extraPages++) {
		if (view.page.links.next === undefined || !isChosen(CHANCE_OF_NEXT_PAGE)) {
			break;
		}
		pauseToThink();
		const nextView = followNextPage(session, view.page.links.next, limit);
		if (nextView === undefined) {
			return;
		}
		view = nextView;
	}

	if (view.page.data.length === 0) {
		return;
	}
	if (isChosen(CHANCE_OF_OPENING_TRANSACTION)) {
		pauseToThink();
		openTransaction(session, pickRandom(view.page.data));
	}
	// On a filtered page a recategorised row can leave the page, so the
	// re-read could not show it; the session recategorises unfiltered pages only
	if (!isFiltered && isChosen(CHANCE_OF_RECATEGORISING)) {
		pauseToThink();
		recategoriseTransaction(session, view, categories);
	}
}

// links.next is relative and carries the window, the filters and the cursor
function followNextPage(session: Session, nextLink: string, limit: number) {
	const url = `${BASE_URL}${nextLink}`;
	const response = http.get(
		url,
		buildRequestParams(session, ROUTES.listTransactions)
	);
	const page = readTransactionPage(response, limit);
	if (page === undefined) {
		return undefined;
	}
	return { url, page };
}

// The portal never calls the detail route; this stands in for a mobile app's tap on a row
function openTransaction(session: Session, transaction: TransactionRow) {
	const response = http.get(
		`${buildUserUrl(session)}/transactions/${transaction.transactionId}`,
		buildRequestParams(session, ROUTES.getTransaction)
	);
	check(response, {
		"transaction opened": (response) =>
			response.status === 200 &&
			response.json("transactionId") === transaction.transactionId
	});
}

// The row's category select: save the override, then read the page again as
// the portal does. A transaction override beats every other category, so the
// re-read must show the new one.
function recategoriseTransaction(
	session: Session,
	view: PageView,
	categories: UserCategory[]
) {
	const transaction = pickRandom(view.page.data);
	const newCategory = pickOtherCategory(categories, transaction.category);
	const response = http.put(
		buildTransactionOverrideUrl(session, transaction.transactionId),
		JSON.stringify({ categoryId: newCategory.id }),
		buildJsonRequestParams(session, ROUTES.putTransactionOverride)
	);
	check(response, {
		"transaction recategorised": (response) =>
			response.status === 200 && response.json("categoryId") === newCategory.id
	});

	const reread = http.get(
		view.url,
		buildRequestParams(session, ROUTES.listTransactions)
	);
	check(reread, {
		"page shows the new category": (reread) =>
			hasTransactionCategory(
				reread,
				transaction.transactionId,
				newCategory.category
			)
	});

	if (isChosen(CHANCE_OF_RESETTING)) {
		pauseToThink();
		resetTransactionCategory(session, view, transaction);
	}
}

// The row's reset button: delete the override, then read the page again
function resetTransactionCategory(
	session: Session,
	view: PageView,
	transaction: TransactionRow
) {
	const response = http.del(
		buildTransactionOverrideUrl(session, transaction.transactionId),
		null,
		buildRequestParams(session, ROUTES.deleteTransactionOverride)
	);
	check(response, {
		"transaction category reset": (response) => response.status === 204
	});
	const reread = http.get(
		view.url,
		buildRequestParams(session, ROUTES.listTransactions)
	);
	readTransactionPage(reread, view.page.meta.limit);
}

// The categories page lists the user's categories, and the user maps one onto
// another; half of them change their mind and undo it
function visitCategoriesPage(session: Session) {
	const response = http.get(
		`${buildUserUrl(session)}/categories`,
		buildRequestParams(session, ROUTES.userCategories)
	);
	const categories = readUserCategories(response);
	if (categories === undefined) {
		return;
	}
	pauseToThink();
	const fromCategory = pickRandom(categories);
	remapCategory(session, fromCategory, categories);
	if (isChosen(CHANCE_OF_UNDOING_REMAP)) {
		pauseToThink();
		undoRemap(session, fromCategory);
	}
}

// Save the mapping, then read the list again as the portal does
function remapCategory(
	session: Session,
	fromCategory: UserCategory,
	categories: UserCategory[]
) {
	const toCategory = pickOtherCategory(categories, fromCategory.category);
	const response = http.put(
		buildCategoryOverrideUrl(session, fromCategory.id),
		JSON.stringify({ toCategoryId: toCategory.id }),
		buildJsonRequestParams(session, ROUTES.putCategoryOverride)
	);
	check(response, {
		"category remapped": (response) =>
			response.status === 200 && response.json("mappedTo.id") === toCategory.id
	});
	readUserCategories(
		http.get(
			`${buildUserUrl(session)}/categories`,
			buildRequestParams(session, ROUTES.userCategories)
		)
	);
}

// Delete the mapping, then read the list again
function undoRemap(session: Session, fromCategory: UserCategory) {
	const response = http.del(
		buildCategoryOverrideUrl(session, fromCategory.id),
		null,
		buildRequestParams(session, ROUTES.deleteCategoryOverride)
	);
	check(response, {
		"category remap undone": (response) => response.status === 204
	});
	readUserCategories(
		http.get(
			`${buildUserUrl(session)}/categories`,
			buildRequestParams(session, ROUTES.userCategories)
		)
	);
}

// The list is undefined when the call failed, so the session stops there
function readUserCategories(response: Response) {
	const isListed = check(response, {
		"categories listed": (response) =>
			response.status === 200 && Array.isArray(response.json("data"))
	});
	if (!isListed) {
		return undefined;
	}
	const body = response.json() as { data: UserCategory[] };
	return body.data;
}

function readTransactionPage(response: Response, limit: number) {
	const isListed = check(response, {
		"transactions listed": (response) =>
			response.status === 200 &&
			Array.isArray(response.json("data")) &&
			response.json("meta.limit") === limit
	});
	if (!isListed) {
		return undefined;
	}
	return response.json() as TransactionPage;
}

function checkSummary(response: Response) {
	check(response, {
		"summary totalled": (response) =>
			response.status === 200 && response.json("totals") !== undefined
	});
}

function hasTransactionCategory(
	response: Response,
	transactionId: string,
	category: string
) {
	if (response.status !== 200) {
		return false;
	}
	const page = response.json() as TransactionPage;
	for (const row of page.data) {
		if (row.transactionId === transactionId) {
			return row.category === category;
		}
	}
	return false;
}

// One filter, as a user picks from the page's selects
function chooseFilter(categories: UserCategory[]) {
	const kind = pickRandom(FILTER_KINDS);
	if (kind === "category") {
		return { category: pickRandom(categories).category };
	}
	if (kind === "transactionType") {
		return { transactionType: pickRandom(TRANSACTION_TYPES) };
	}
	return { creditDebitIndicator: pickRandom(CREDIT_DEBIT_INDICATORS) };
}

function pickOtherCategory(categories: UserCategory[], excludedSlug: string) {
	const others = [];
	for (const category of categories) {
		if (category.category !== excludedSlug) {
			others.push(category);
		}
	}
	return pickRandom(others);
}

// The last `months` months up to the anchor day; toDateTime is exclusive, so
// it is the start of the next day
function buildWindow(months: number) {
	const toDateTime = new Date(`${ANCHOR_DATE}T00:00:00.000Z`);
	toDateTime.setUTCDate(toDateTime.getUTCDate() + 1);
	const fromDateTime = new Date(toDateTime);
	fromDateTime.setUTCMonth(fromDateTime.getUTCMonth() - months);
	return {
		fromDateTime: fromDateTime.toISOString(),
		toDateTime: toDateTime.toISOString()
	};
}

function buildQueryString(parameters: Record<string, string>) {
	const pairs = [];
	for (const [name, value] of Object.entries(parameters)) {
		pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
	}
	return pairs.join("&");
}

function buildUserUrl(session: Session) {
	return `${BASE_URL}/api/v1/users/${session.userId}`;
}

function buildTransactionOverrideUrl(session: Session, transactionId: string) {
	return `${buildUserUrl(session)}/transaction-overrides/${transactionId}`;
}

function buildCategoryOverrideUrl(session: Session, categoryId: number) {
	return `${buildUserUrl(session)}/category-overrides/${categoryId}`;
}

function buildRequestParams(session: Session, route: string) {
	return {
		headers: {
			Authorization: `Bearer ${session.accessToken}`,
			Accept: "application/json"
		},
		tags: { name: route }
	};
}

// Only requests with a body declare one: Fastify rejects an empty body sent as JSON
function buildJsonRequestParams(session: Session, route: string) {
	return {
		headers: {
			Authorization: `Bearer ${session.accessToken}`,
			Accept: "application/json",
			"Content-Type": "application/json"
		},
		tags: { name: route }
	};
}

function pickRandom<Item>(items: Item[]) {
	const item = items[Math.floor(Math.random() * items.length)];
	if (item === undefined) {
		throw new Error("pickRandom needs at least one item");
	}
	return item;
}

function isChosen(probability: number) {
	return Math.random() < probability;
}

// Between pages a user reads for one to five seconds
function pauseToThink() {
	sleep(
		SHORTEST_THINK_SECONDS +
			Math.random() * (LONGEST_THINK_SECONDS - SHORTEST_THINK_SECONDS)
	);
}
