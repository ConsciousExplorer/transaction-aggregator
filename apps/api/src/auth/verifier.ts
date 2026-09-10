import {
	createRemoteJWKSet,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify
} from "jose";
import z from "zod";
import { InvalidClaimsError, mapJoseError } from "#src/errors/auth-errors.ts";

// Always use zod to parse external data entering our system.
// Data structure and recommended claims
// https://datatracker.ietf.org/doc/html/rfc9068#name-data-structure
const verifiedClaimsSchema = z.looseObject({
	sub: z.string(),
	scope: z.string()
});

export type VerifiedClaims = z.infer<typeof verifiedClaimsSchema>;

export interface AuthContext {
	clientId: string;
	scope: string[];
}

export function parseClaims(payload: JWTPayload): VerifiedClaims {
	const result = verifiedClaimsSchema.safeParse(payload);
	if (!result.success) throw new InvalidClaimsError(result.error.issues);
	return result.data;
}

export function createTokenVerifier(
	config: { jwksUri: string; issuer: string; audience: string },
	getKey: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri))
) {
	return async function verifyToken(token: string): Promise<VerifiedClaims> {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(token, getKey, {
				issuer: config.issuer,
				audience: config.audience,
				algorithms: ["RS256"]
			}));
		} catch (err) {
			throw mapJoseError(err);
		}
		return parseClaims(payload);
	};
}

export function getContext(claims: VerifiedClaims): AuthContext {
	return { clientId: claims.sub, scope: claims.scope.split(" ") };
}

export function getAuthScopes(ctx: AuthContext, required: string[]): boolean {
	return required.every((s) => ctx.scope.includes(s));
}
