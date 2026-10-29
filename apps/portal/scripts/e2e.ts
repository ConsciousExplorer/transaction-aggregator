// End-to-end check of the portal's BFF against a running stack. It covers only what needs the
// whole stack: a customer signs in through Keycloak the way a browser does, reads through the
// BFF, and signs out, and on the way the BFF's two guards are tried. Paging, filters and writes
// are tested in the portal's unit tests and in the API.
//
// Needs the stack from `make up` (Keycloak, the API and the portal).
// Usage: npm run test:e2e [portal base URL]    (default http://localhost:8084)

import { buildPeriod } from "../src/lib/periods.ts";
import type { TransactionPage } from "../src/lib/types.ts";

type CookieJar = Map<string, string>;

type Problem = { type: string };

const DEFAULT_PORTAL = "http://localhost:8084";

const JANE_DOE_CUSTOMER_ID = "12fdd94b-dc11-42fe-8c95-128011e02e77";

function reportCheck(name: string, passed: boolean) {
	console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
	return passed;
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
		body: (text === "" ? undefined : JSON.parse(text)) as Body
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
	if (formAction === undefined)
		throw new Error(`Keycloak showed no login form (${loginPage.status})`);
	const submitted = await sendRequest(keycloakJar, formAction, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ username, password, credentialId: "" })
	});
	const callback = await sendRequest(
		portalJar,
		submitted.headers.get("location") ?? ""
	);
	return { jar: portalJar, landedOn: callback.headers.get("location") ?? "" };
}

function countFailures(results: boolean[]) {
	let failures = 0;
	for (const passed of results) {
		if (!passed) failures += 1;
	}
	return failures;
}

async function runChecks(portal: string) {
	const results: boolean[] = [];
	const windowQuery = new URLSearchParams(buildPeriod(12, new Date()));
	const transactionsUrl = `${portal}/bff/transactions?${windowQuery}&limit=10`;

	const johnDoe = await signIn(portal, "john.doe", "portal-password");
	results.push(
		reportCheck(
			"signing in through Keycloak lands on /overview with a session",
			johnDoe.landedOn === `${portal}/overview` &&
				johnDoe.jar.has("portal_session")
		)
	);

	const page = await readJson<TransactionPage>(johnDoe.jar, transactionsUrl);
	const firstTransactionId = page.body.transactions[0]?.transactionId;
	results.push(
		reportCheck(
			"/bff/transactions reads the customer's rows from the API",
			page.status === 200 && firstTransactionId !== undefined
		)
	);

	// The BFF takes the customer from the session; a userId the browser adds is dropped
	const injected = await readJson<TransactionPage>(
		johnDoe.jar,
		`${transactionsUrl}&userId=${JANE_DOE_CUSTOMER_ID}`
	);
	results.push(
		reportCheck(
			"a userId parameter is ignored: still John Doe's rows",
			injected.status === 200 &&
				injected.body.transactions[0]?.transactionId === firstTransactionId
		)
	);

	// The Origin check runs before anything else, so the body doesn't have to be valid
	const foreign = await readJson<Problem>(
		johnDoe.jar,
		`${portal}/bff/transactions/${firstTransactionId}/category`,
		{
			method: "PUT",
			headers: {
				origin: "http://evil.example",
				"content-type": "application/json"
			},
			body: JSON.stringify({ categoryId: 1 })
		}
	);
	results.push(
		reportCheck(
			"a write from another origin is refused",
			foreign.status === 403 && foreign.body.type === "foreign-origin"
		)
	);

	const logout = await sendRequest(johnDoe.jar, `${portal}/bff/auth/logout`, {
		method: "POST",
		headers: { origin: portal }
	});
	results.push(
		reportCheck(
			"signing out also signs out of Keycloak",
			logout.status === 303 &&
				(logout.headers.get("location") ?? "").includes(
					"/protocol/openid-connect/logout"
				)
		)
	);

	const afterLogout = await readJson<Problem>(johnDoe.jar, transactionsUrl);
	results.push(
		reportCheck(
			"after signing out, a read is a 401 not-signed-in problem",
			afterLogout.status === 401 && afterLogout.body.type === "not-signed-in"
		)
	);

	return results;
}

const results = await runChecks(process.argv[2] ?? DEFAULT_PORTAL);
const failures = countFailures(results);
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures === 0 ? 0 : 1);
