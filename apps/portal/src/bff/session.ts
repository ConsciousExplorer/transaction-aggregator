import {
	getIronSession,
	type SessionOptions,
	sealData,
	type UnsealErrorReason,
	unsealData
} from "iron-session";
import { cookies } from "next/headers";
import type { BffConfig } from "./config.ts";
import { notSignedInError } from "./problems.ts";

// The session is a sealed cookie (encrypted and signed), with no server-side store: the BFF stays
// stateless. The browser can't read it (httpOnly), and it holds no token the API would accept.
type PortalSession = {
	customerId: string;
	displayName: string;
	idToken: string;
};

type LoginAttempt = { state: string; codeVerifier: string };

const SESSION_COOKIE = "portal_session";
const SESSION_SECONDS = 3600;
const LOGIN_COOKIE = "portal_login";
const LOGIN_SECONDS = 600;
const LOGIN_COOKIE_PATH = "/bff/auth";

function isHttps(config: BffConfig) {
	return config.publicBaseUrl.startsWith("https://");
}

// An expired cookie is how sessions end; anything else may be tampering, so it gets a log line
function logUnsealError(reason: UnsealErrorReason) {
	if (reason !== "expired")
		console.warn(JSON.stringify({ event: "session-cookie-rejected", reason }));
}

function buildSessionOptions(config: BffConfig): SessionOptions {
	return {
		cookieName: SESSION_COOKIE,
		password: config.sessionSecret,
		ttl: SESSION_SECONDS,
		cookieOptions: {
			httpOnly: true,
			sameSite: "lax",
			secure: isHttps(config),
			path: "/"
		},
		onUnsealError: logUnsealError
	};
}

export async function openSession(config: BffConfig) {
	return getIronSession<PortalSession>(
		await cookies(),
		buildSessionOptions(config)
	);
}

export async function readCustomer(config: BffConfig) {
	const session = await openSession(config);
	if (!session.customerId) return undefined;
	return {
		customerId: session.customerId,
		displayName: session.displayName ?? "Customer"
	};
}

export async function requireCustomer(config: BffConfig) {
	const customer = await readCustomer(config);
	if (customer === undefined) throw notSignedInError();
	return customer;
}

// The login attempt lives in its own short cookie, scoped to /bff/auth, from the redirect to
// Keycloak until the callback. SameSite=Lax still sends it on Keycloak's top-level redirect back.
export async function saveLoginAttempt(
	config: BffConfig,
	attempt: LoginAttempt
) {
	const seal = await sealData(attempt, {
		password: config.sessionSecret,
		ttl: LOGIN_SECONDS
	});
	const cookieStore = await cookies();
	cookieStore.set(LOGIN_COOKIE, seal, {
		httpOnly: true,
		sameSite: "lax",
		secure: isHttps(config),
		path: LOGIN_COOKIE_PATH,
		maxAge: LOGIN_SECONDS
	});
}

// Reads the attempt once and deletes it, so a reloaded callback can't replay it
export async function takeLoginAttempt(config: BffConfig) {
	const cookieStore = await cookies();
	const seal = cookieStore.get(LOGIN_COOKIE)?.value;
	if (seal === undefined) return undefined;
	cookieStore.delete({ name: LOGIN_COOKIE, path: LOGIN_COOKIE_PATH });
	const attempt = await unsealData<Partial<LoginAttempt>>(seal, {
		password: config.sessionSecret,
		ttl: LOGIN_SECONDS,
		onUnsealError: logUnsealError
	});
	if (!attempt.state || !attempt.codeVerifier) return undefined;
	return { state: attempt.state, codeVerifier: attempt.codeVerifier };
}
