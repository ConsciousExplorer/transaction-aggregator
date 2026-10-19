import { NextResponse } from "next/server";
import { loadConfig } from "@/bff/config.ts";
import { buildAuthorizeUrl, createLoginAttempt } from "@/bff/keycloak.ts";
import { saveLoginAttempt } from "@/bff/session.ts";

// Starts the authorization-code flow: remember state and the PKCE verifier, send the browser to Keycloak
export async function GET() {
	const config = loadConfig();
	const attempt = createLoginAttempt();
	await saveLoginAttempt(config, {
		state: attempt.state,
		codeVerifier: attempt.codeVerifier
	});
	return NextResponse.redirect(
		buildAuthorizeUrl(config, attempt.state, attempt.codeChallenge),
		302
	);
}
