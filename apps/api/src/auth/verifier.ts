import {
	createRemoteJWKSet,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify
} from "jose";
import z from "zod";
import {
	InvalidClaimsError,
	translateJoseError
} from "#src/errors/auth-errors.ts";

export interface AuthConfig {
	jwksUri: string;
	issuer: string;
	audience: string;
}

// Always use zod to parse external data entering our system.
// Data structure and recommended claims
// https://datatracker.ietf.org/doc/html/rfc9068#name-data-structure
const verifiedClaimsSchema = z.looseObject({
	sub: z.string(),
	// The client that asked for the token. With client credentials sub is the
	// identity provider's internal service-account id, not the app.
	azp: z.string(),
	scope: z.string()
});

export type VerifiedClaims = z.infer<typeof verifiedClaimsSchema>;

export interface AuthContext {
	clientId: string;
	scope: string[];
}

export function parseClaims(payload: JWTPayload) {
	const result = verifiedClaimsSchema.safeParse(payload);
	if (!result.success) throw new InvalidClaimsError(result.error.issues);
	return result.data;
}

/**
 * What verifying a token needs: where the signing keys come from, who must have
 * issued the token, and who it must be for. Built once at boot.
 */
export interface TokenVerification {
	getSigningKey: JWTVerifyGetKey;
	issuer: string;
	audience: string;
}

/** The remote key set is fetched lazily and cached by jose, so this is cheap. */
export function buildTokenVerification(config: AuthConfig) {
	return {
		getSigningKey: createRemoteJWKSet(new URL(config.jwksUri)),
		issuer: config.issuer,
		audience: config.audience
	};
}

export async function verifyToken(
	token: string,
	verification: TokenVerification
) {
	let payload: JWTPayload;
	try {
		({ payload } = await jwtVerify(token, verification.getSigningKey, {
			issuer: verification.issuer,
			audience: verification.audience,
			algorithms: ["RS256"]
		}));
	} catch (error) {
		throw translateJoseError(error);
	}
	return parseClaims(payload);
}

export function buildAuthContext(claims: VerifiedClaims) {
	return { clientId: claims.azp, scope: claims.scope.split(" ") };
}

export function hasRequiredScopes(
	authContext: AuthContext,
	requiredScope: string[]
) {
	return requiredScope.every((scope) => authContext.scope.includes(scope));
}
