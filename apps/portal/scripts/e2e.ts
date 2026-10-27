// End-to-end check of the portal's BFF against a running stack. It signs in through Keycloak
// the way a browser does, then exercises every BFF route, the security refusals and the
// sign-in failure modes. The writes undo themselves.
//
// Needs the stack from `make up` (Keycloak, the API and the portal).
// Usage: npm run test:e2e [portal base URL]    (default http://localhost:8084)

import { buildPeriod } from "../src/lib/periods.ts";
import type {
	Category,
	Customer,
	Summary,
	Transaction,
	TransactionPage
} from "../src/lib/types.ts";

type CookieJar = Map<string, string>;

type CheckResult = { name: string; passed: boolean };

type Problem = { type: string; title: string; trace_id?: string };

type ReadContext = { firstPage: TransactionPage; categories: Category[] };

const DEFAULT_PORTAL = "http://localhost:8084";

const JOHN_DOE_CUSTOMER_ID = "46acaa64-caf9-4577-b4a0-c25f09a8bb66";

const JANE_DOE_CUSTOMER_ID = "12fdd94b-dc11-42fe-8c95-128011e02e77";

function recordCheck(
	results: CheckResult[],
	name: string,
	passed: boolean,
	detail = ""
) {
	results.push({ name, passed });
	console.log(
		`${passed ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  (${detail})`}`
	);
}

// Keeps cookies the way a browser would; one the server expires is dropped
function collectCookies(response: Response, jar: CookieJar) {
	for (const cookie of response.headers.getSetCookie()) {
		const pair = cookie.split(";")[0] ?? "";
		const separator = pair.indexOf("=");
		const name = pair.slice(0, separator);
		const value = pair.slice(separator + 1);
		const isExpired =
			value === "" || /max-age=0|expires=thu, 01 jan 1970/i.test(cookie);
		if (isExpired) jar.delete(name);
		else jar.set(name, value);
	}
}

function buildCookieHeader(jar: CookieJar) {
	const pairs: string[] = [];
	for (const [name, value] of jar) {
		pairs.push(`${name}=${value}`);
	}
	return pairs.join("; ");
}

async function sendRequest(
	jar: CookieJar,
	url: string,
	init: RequestInit = {}
) {
	const headers = new Headers(init.headers);
	headers.set("cookie", buildCookieHeader(jar));
	const response = await fetch(url, { ...init, headers, redirect: "manual" });
	collectCookies(response, jar);
	return response;
}

async function readJson<Body>(
	jar: CookieJar,
	url: string,
	init: RequestInit = {}
) {
	const response = await sendRequest(jar, url, init);
	const text = await response.text();
	return {
		status: response.status,
		body: (text === "" ? undefined : JSON.parse(text)) as Body,
		contentType: response.headers.get("content-type") ?? ""
	};
}

function readLoginFormAction(html: string) {
	const match = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/);
	return match?.[1]?.replaceAll("&amp;", "&");
}

// The portal → Keycloak's login form → credentials → the portal's callback
async function signIn(portal: string, username: string, password: string) {
	const portalJar: CookieJar = new Map();
	const keycloakJar: CookieJar = new Map();
	const login = await sendRequest(portalJar, `${portal}/bff/auth/login`);
	const loginPage = await sendRequest(
		keycloakJar,
		login.headers.get("location") ?? ""
	);
	const formAction = readLoginFormAction(await loginPage.text());
	if (formAction === undefined) {
		return {
			jar: portalJar,
			loginStatus: login.status,
			callbackStatus: 0,
			finalLocation: `no login form (${loginPage.status})`
		};
	}
	const submitted = await sendRequest(keycloakJar, formAction, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ username, password, credentialId: "" })
	});
	const callback = await sendRequest(
		portalJar,
		submitted.headers.get("location") ?? ""
	);
	return {
		jar: portalJar,
		loginStatus: login.status,
		callbackStatus: callback.status,
		finalLocation: callback.headers.get("location") ?? ""
	};
}

function buildWindowQuery() {
	return new URLSearchParams(buildPeriod(12, new Date())).toString();
}

function findTransaction(transactions: Transaction[], transactionId: string) {
	return transactions.find(
		(transaction) => transaction.transactionId === transactionId
	);
}

function findOtherCategory(categories: Category[], slug: string) {
	return categories.find((category) => category.category !== slug);
}

function hasMonthOnEveryRow(summary: Summary) {
	for (const row of summary.data) {
		if (row.group.month === undefined) return false;
	}
	return true;
}

function countFailures(results: CheckResult[]) {
	let failures = 0;
	for (const result of results) {
		if (!result.passed) failures += 1;
	}
	return failures;
}

async function checkReads(
	portal: string,
	results: CheckResult[],
	jar: CookieJar
) {
	const windowQuery = buildWindowQuery();

	const me = await readJson<Customer>(jar, `${portal}/bff/me`);
	recordCheck(
		results,
		"/bff/me is John Doe",
		me.status === 200 &&
			me.body.customerId === JOHN_DOE_CUSTOMER_ID &&
			me.body.displayName === "John Doe"
	);

	const categoryList = await readJson<{ categories: Category[] }>(
		jar,
		`${portal}/bff/categories`
	);
	const categories = categoryList.body.categories;
	recordCheck(
		results,
		"/bff/categories lists categories",
		categoryList.status === 200 && categories.length > 5,
		`${categories.length} categories`
	);

	const byCategory = await readJson<Summary & { links?: unknown }>(
		jar,
		`${portal}/bff/summary?${windowQuery}`
	);
	recordCheck(
		results,
		"/bff/summary by category, with no API links",
		byCategory.status === 200 &&
			byCategory.body.data.length > 0 &&
			byCategory.body.links === undefined
	);

	const byMonth = await readJson<Summary>(
		jar,
		`${portal}/bff/summary?${windowQuery}&interval=month`
	);
	recordCheck(
		results,
		"/bff/summary by month",
		byMonth.status === 200 &&
			byMonth.body.data.length > 0 &&
			hasMonthOnEveryRow(byMonth.body)
	);

	const firstPage = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10`
	);
	recordCheck(
		results,
		"/bff/transactions page 1 has a nextCursor and no previousCursor",
		firstPage.status === 200 &&
			firstPage.body.transactions.length === 10 &&
			firstPage.body.nextCursor !== undefined &&
			firstPage.body.previousCursor === undefined
	);

	const firstTransactionId = firstPage.body.transactions[0]?.transactionId;
	const secondPage = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10&cursor=${encodeURIComponent(firstPage.body.nextCursor ?? "")}`
	);
	recordCheck(
		results,
		"following nextCursor gives page 2 with a previousCursor",
		secondPage.status === 200 &&
			secondPage.body.previousCursor !== undefined &&
			secondPage.body.transactions[0]?.transactionId !== firstTransactionId
	);

	const backToFirst = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10&cursor=${encodeURIComponent(secondPage.body.previousCursor ?? "")}`
	);
	recordCheck(
		results,
		"following previousCursor returns to page 1",
		backToFirst.status === 200 &&
			backToFirst.body.transactions[0]?.transactionId === firstTransactionId
	);

	// The BFF takes the user from the session; a userId the browser adds is dropped
	const injected = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10&userId=${JANE_DOE_CUSTOMER_ID}`
	);
	recordCheck(
		results,
		"a userId parameter is ignored: still John Doe's rows",
		injected.status === 200 &&
			injected.body.transactions[0]?.transactionId === firstTransactionId
	);

	return { firstPage: firstPage.body, categories };
}

async function checkWrites(
	portal: string,
	results: CheckResult[],
	jar: CookieJar,
	context: ReadContext
) {
	const windowQuery = buildWindowQuery();
	const writeHeaders = { origin: portal, "content-type": "application/json" };
	const target = context.firstPage.transactions[0];
	if (target === undefined)
		throw new Error("John Doe has no transactions in the last 12 months");

	const otherCategory = findOtherCategory(context.categories, target.category);
	if (otherCategory === undefined)
		throw new Error("no second category to re-categorise into");
	const recategorised = await readJson<unknown>(
		jar,
		`${portal}/bff/transactions/${target.transactionId}/category`,
		{
			method: "PUT",
			headers: writeHeaders,
			body: JSON.stringify({ categoryId: otherCategory.id })
		}
	);
	recordCheck(
		results,
		"PUT a transaction's category",
		recategorised.status === 200,
		`${target.category} to ${otherCategory.category}`
	);
	const afterPut = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10`
	);
	recordCheck(
		results,
		"the list shows the new category",
		findTransaction(afterPut.body.transactions, target.transactionId)
			?.category === otherCategory.category
	);
	const reset = await sendRequest(
		jar,
		`${portal}/bff/transactions/${target.transactionId}/category`,
		{
			method: "DELETE",
			headers: { origin: portal }
		}
	);
	recordCheck(results, "DELETE a transaction's category", reset.status === 204);
	const afterReset = await readJson<TransactionPage>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&limit=10`
	);
	recordCheck(
		results,
		"the list shows the system category again",
		findTransaction(afterReset.body.transactions, target.transactionId)
			?.category === target.category
	);

	const fromCategory = context.categories.find(
		(category) => category.mappedTo === undefined
	);
	if (fromCategory === undefined)
		throw new Error("every category is already remapped");
	const toCategory = findOtherCategory(
		context.categories,
		fromCategory.category
	);
	if (toCategory === undefined)
		throw new Error("no second category to remap to");
	const remapped = await readJson<unknown>(
		jar,
		`${portal}/bff/categories/${fromCategory.id}/mapping`,
		{
			method: "PUT",
			headers: writeHeaders,
			body: JSON.stringify({ toCategoryId: toCategory.id })
		}
	);
	recordCheck(
		results,
		"PUT a category remap",
		remapped.status === 200,
		`${fromCategory.category} to ${toCategory.category}`
	);
	const afterRemap = await readJson<{ categories: Category[] }>(
		jar,
		`${portal}/bff/categories`
	);
	const remappedCategory = afterRemap.body.categories.find(
		(category) => category.id === fromCategory.id
	);
	recordCheck(
		results,
		"categories show the remap",
		remappedCategory?.mappedTo?.id === toCategory.id
	);
	const unmapped = await sendRequest(
		jar,
		`${portal}/bff/categories/${fromCategory.id}/mapping`,
		{
			method: "DELETE",
			headers: { origin: portal }
		}
	);
	recordCheck(results, "DELETE a category remap", unmapped.status === 204);
	const afterUnmap = await readJson<{ categories: Category[] }>(
		jar,
		`${portal}/bff/categories`
	);
	const unmappedCategory = afterUnmap.body.categories.find(
		(category) => category.id === fromCategory.id
	);
	recordCheck(
		results,
		"the remap is gone",
		unmappedCategory?.mappedTo === undefined
	);
}

async function checkRefusals(
	portal: string,
	results: CheckResult[],
	jar: CookieJar,
	context: ReadContext
) {
	const windowQuery = buildWindowQuery();
	const target = context.firstPage.transactions[0];
	const category = context.categories[0];
	if (target === undefined || category === undefined)
		throw new Error("nothing to write to");

	const foreign = await readJson<Problem>(
		jar,
		`${portal}/bff/transactions/${target.transactionId}/category`,
		{
			method: "PUT",
			headers: {
				origin: "http://evil.example",
				"content-type": "application/json"
			},
			body: JSON.stringify({ categoryId: category.id })
		}
	);
	recordCheck(
		results,
		"a write from another origin is refused",
		foreign.status === 403 && foreign.body.type === "foreign-origin"
	);

	const badBody = await readJson<Problem>(
		jar,
		`${portal}/bff/transactions/${target.transactionId}/category`,
		{
			method: "PUT",
			headers: { origin: portal, "content-type": "application/json" },
			body: JSON.stringify({ categoryId: "groceries" })
		}
	);
	recordCheck(
		results,
		"a malformed write body is a 400 problem",
		badBody.status === 400 && badBody.body.type === "invalid-request"
	);

	const anonymous = await readJson<Problem>(
		new Map(),
		`${portal}/bff/transactions?${windowQuery}`
	);
	recordCheck(
		results,
		"no session gives a 401 not-signed-in problem",
		anonymous.status === 401 &&
			anonymous.body.type === "not-signed-in" &&
			anonymous.contentType.includes("problem+json")
	);

	const garbage = await readJson<Problem>(
		jar,
		`${portal}/bff/transactions?${windowQuery}&cursor=garbage`
	);
	recordCheck(
		results,
		"a garbage cursor gives a 400 problem with a trace id",
		garbage.status === 400 && garbage.body.trace_id !== undefined,
		`${garbage.body.type} ${garbage.body.trace_id}`
	);

	const strayCallback = await sendRequest(
		new Map(),
		`${portal}/bff/auth/callback?code=x&state=y`
	);
	recordCheck(
		results,
		"a callback without a login attempt goes to /?error=login-expired",
		strayCallback.status === 302 &&
			strayCallback.headers.get("location") === `${portal}/?error=login-expired`
	);
}

// A realm user with no customer behind them gets no session and is signed out of Keycloak
async function checkNonCustomer(portal: string, results: CheckResult[]) {
	const viewer = await signIn(portal, "kafka-viewer", "kafka-password");
	recordCheck(
		results,
		"a non-customer gets no session",
		!viewer.jar.has("portal_session")
	);
	recordCheck(
		results,
		"a non-customer is signed out of Keycloak and sent to /?error=not-a-customer",
		viewer.finalLocation.includes("/protocol/openid-connect/logout") &&
			decodeURIComponent(viewer.finalLocation).includes(
				`${portal}/?error=not-a-customer`
			)
	);
}

async function checkSignOut(
	portal: string,
	results: CheckResult[],
	jar: CookieJar
) {
	const logout = await sendRequest(jar, `${portal}/bff/auth/logout`, {
		method: "POST",
		headers: { origin: portal }
	});
	recordCheck(
		results,
		"sign out answers 303 to Keycloak's logout",
		logout.status === 303 &&
			(logout.headers.get("location") ?? "").includes(
				"/protocol/openid-connect/logout"
			)
	);
	recordCheck(
		results,
		"sign out clears the session cookie",
		!jar.has("portal_session")
	);
	const afterLogout = await readJson<Problem>(jar, `${portal}/bff/me`);
	recordCheck(
		results,
		"after sign out, /bff/me is 401",
		afterLogout.status === 401
	);
}

async function runChecks(portal: string) {
	const results: CheckResult[] = [];
	const johnDoe = await signIn(portal, "john.doe", "portal-password");
	recordCheck(
		results,
		"login redirects to Keycloak",
		johnDoe.loginStatus === 302
	);
	recordCheck(
		results,
		"the callback signs in and lands on /overview",
		johnDoe.callbackStatus === 302 &&
			johnDoe.finalLocation === `${portal}/overview`,
		johnDoe.finalLocation
	);
	recordCheck(
		results,
		"the session cookie is set",
		johnDoe.jar.has("portal_session")
	);
	recordCheck(
		results,
		"the login-attempt cookie is used up",
		!johnDoe.jar.has("portal_login")
	);

	const context = await checkReads(portal, results, johnDoe.jar);
	await checkWrites(portal, results, johnDoe.jar, context);
	await checkRefusals(portal, results, johnDoe.jar, context);
	await checkNonCustomer(portal, results);
	await checkSignOut(portal, results, johnDoe.jar);
	return results;
}

const results = await runChecks(process.argv[2] ?? DEFAULT_PORTAL);
const failures = countFailures(results);
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures === 0 ? 0 : 1);
