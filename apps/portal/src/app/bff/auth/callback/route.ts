import { NextResponse } from "next/server";
import { type BffConfig, loadConfig } from "@/bff/config.ts";
import { buildLogoutUrl, exchangeCode, verifyIdToken } from "@/bff/keycloak.ts";
import { openSession, takeLoginAttempt } from "@/bff/session.ts";

// Redirects are built from the public base URL, never from request.url: inside Docker the
// request's host is the container's (0.0.0.0:8084), not what the browser sees
function redirectToSignIn(config: BffConfig, error: string) {
	return NextResponse.redirect(
		new URL(`/?error=${error}`, config.publicBaseUrl),
		302
	);
}

export async function GET(request: Request) {
	const config = loadConfig();
	const parameters = new URL(request.url).searchParams;
	try {
		// No attempt (a reloaded or bookmarked callback) or the wrong state: start again
		const attempt = await takeLoginAttempt(config);
		if (attempt === undefined || parameters.get("state") !== attempt.state) {
			return redirectToSignIn(config, "login-expired");
		}
		const code = parameters.get("code");
		if (code === null) return redirectToSignIn(config, "login-failed");

		const idToken = await exchangeCode(config, code, attempt.codeVerifier);
		const claims = await verifyIdToken(config, idToken);

		// A realm user with no customer behind them (kafka-admin, say) gets no session, and is
		// signed out of Keycloak so the next sign-in can pick another account
		if (claims.customer_id === undefined) {
			return NextResponse.redirect(
				buildLogoutUrl(config, idToken, "/?error=not-a-customer"),
				302
			);
		}

		const session = await openSession(config);
		session.customerId = claims.customer_id;
		session.displayName =
			claims.name ?? claims.preferred_username ?? "Customer";
		session.idToken = idToken;
		await session.save();
		return NextResponse.redirect(
			new URL("/overview", config.publicBaseUrl),
			302
		);
	} catch (error) {
		console.error(
			JSON.stringify({ event: "login-failed", error: String(error) })
		);
		return redirectToSignIn(config, "login-failed");
	}
}
