import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { BffConfig } from "./config.ts";

// Keycloak has two addresses. The public one is what the browser is sent to, and what Keycloak
// writes as the token issuer. The internal one is how the BFF reaches it from inside Docker.
function buildRealmUrl(baseUrl: string, realm: string) {
	return `${baseUrl}/realms/${realm}`;
}

function buildCallbackUrl(config: BffConfig) {
	return `${config.publicBaseUrl}/bff/auth/callback`;
}

// state ties the callback to this browser's login; the PKCE verifier proves the code exchange
// comes from whoever started the login, so a stolen code is useless on its own
export function createLoginAttempt() {
	const state = randomBytes(16).toString("base64url");
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { state, codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(config: BffConfig, state: string, codeChallenge: string) {
	const url = new URL(`${buildRealmUrl(config.keycloakPublicUrl, config.realm)}/protocol/openid-connect/auth`);
	url.search = new URLSearchParams({
		client_id: config.portalClient.id,
		response_type: "code",
		scope: "openid profile",
		redirect_uri: buildCallbackUrl(config),
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256"
	}).toString();
	return url;
}

const codeExchangeSchema = z.object({ id_token: z.string() });

export async function exchangeCode(config: BffConfig, code: string, codeVerifier: string) {
	const response = await fetch(`${buildRealmUrl(config.keycloakInternalUrl, config.realm)}/protocol/openid-connect/token`, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: buildCallbackUrl(config),
			client_id: config.portalClient.id,
			client_secret: config.portalClient.secret,
			code_verifier: codeVerifier
		})
	});
	if (!response.ok) throw new Error(`Keycloak code exchange answered ${response.status}: ${await response.text()}`);
	return codeExchangeSchema.parse(await response.json()).id_token;
}

const idTokenClaimsSchema = z.object({
	customer_id: z.uuid().optional(),
	name: z.string().optional(),
	preferred_username: z.string().optional()
});

// The ID token came straight from Keycloak's token endpoint, but it is still verified: signature
// against the realm's keys, issuer, and audience. A new key set per sign-in keeps the BFF free of
// a cache; sign-ins are rare.
export async function verifyIdToken(config: BffConfig, idToken: string) {
	const keySet = createRemoteJWKSet(
		new URL(`${buildRealmUrl(config.keycloakInternalUrl, config.realm)}/protocol/openid-connect/certs`)
	);
	const { payload } = await jwtVerify(idToken, keySet, {
		issuer: buildRealmUrl(config.keycloakPublicUrl, config.realm),
		audience: config.portalClient.id
	});
	return idTokenClaimsSchema.parse(payload);
}

// Ends the Keycloak session too, so the next sign-in asks for a password again
export function buildLogoutUrl(config: BffConfig, idToken: string, returnPath: string) {
	const url = new URL(`${buildRealmUrl(config.keycloakPublicUrl, config.realm)}/protocol/openid-connect/logout`);
	url.search = new URLSearchParams({
		client_id: config.portalClient.id,
		id_token_hint: idToken,
		post_logout_redirect_uri: `${config.publicBaseUrl}${returnPath}`
	}).toString();
	return url;
}

const clientCredentialsSchema = z.object({ access_token: z.string(), expires_in: z.number() });

// The BFF's own identity towards the API: banking-portal, scopes tx:read tx:write
export async function requestServiceToken(config: BffConfig) {
	const response = await fetch(`${buildRealmUrl(config.keycloakInternalUrl, config.realm)}/protocol/openid-connect/token`, {
		method: "POST",
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: config.serviceClient.id,
			client_secret: config.serviceClient.secret
		})
	});
	if (!response.ok) throw new Error(`Keycloak client credentials answered ${response.status}`);
	const token = clientCredentialsSchema.parse(await response.json());
	return { accessToken: token.access_token, expiresInSeconds: token.expires_in };
}
