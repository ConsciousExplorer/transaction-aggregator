import assert from "node:assert/strict";
import { once } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import { suite, test } from "node:test";
import { createRemoteJWKSet, generateKeyPair } from "jose";
import { ZodError } from "zod";
import {
	buildTestSigningKeys,
	signTestToken,
	TEST_AUDIENCE,
	TEST_ISSUER
} from "./test-tokens.ts";
import {
	buildAuthContext,
	hasRequiredScopes,
	parseClaims,
	type TokenVerification,
	verifyToken
} from "./verifier.ts";

// Made once for the file, and verified for real
const { privateKey, tokenVerification } = await buildTestSigningKeys();

/**
 * Verifying the token fails with an error that has every property in
 * `expected`: jose's own error for a bad token, ours for a key set that can't
 * be fetched
 */
async function assertRejectsWith(
	token: Promise<string> | string,
	verification: TokenVerification,
	expected: Record<string, string>
) {
	await assert.rejects(
		async () => verifyToken(await token, verification),
		expected
	);
}

/** Verifying the token fails because the claim jose names is wrong or missing */
async function assertRejectsOnClaim(
	token: Promise<string> | string,
	claim: string
) {
	await assertRejectsWith(token, tokenVerification, {
		code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
		claim
	});
}

/** parseClaims throws, keeping zod's issues as the cause */
function readClaimIssuePaths(payload: Record<string, unknown>) {
	try {
		parseClaims(payload);
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.equal(error.message, "Missing or malformed required claims");
		assert.ok(error.cause instanceof ZodError);
		const paths = [];
		for (const issue of error.cause.issues) {
			paths.push(issue.path);
		}
		return paths;
	}
	assert.fail("expected parseClaims to throw");
}

/** Verification that fetches its key set from the identity provider at this URL */
function buildRemoteVerification(jwksUri: string) {
	return {
		getSigningKey: createRemoteJWKSet(new URL(jwksUri)),
		issuer: TEST_ISSUER,
		audience: TEST_AUDIENCE
	};
}

// An identity provider that is up but cannot serve its keys
function answerUnavailable(
	_request: IncomingMessage,
	response: ServerResponse
) {
	response.statusCode = 503;
	response.end();
}

suite("Token Verifier", () => {
	test("should verify a valid token", async () => {
		const token = await signTestToken(privateKey, {
			sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
			azp: "banking-service",
			scope: "read write"
		});

		const claims = await verifyToken(token, tokenVerification);

		assert.equal(claims.sub, "4fc8a801-206d-48ec-b511-d1f97e2f057b");
		assert.equal(claims.azp, "banking-service");
		assert.equal(claims.scope, "read write");
		assert.equal(claims.iss, TEST_ISSUER);
		assert.equal(claims.aud, TEST_AUDIENCE);
	});

	// Negative test cases
	test("Should reject an expired token", async () => {
		await assertRejectsWith(
			signTestToken(privateKey, {}, { expiresIn: "-1s" }),
			tokenVerification,
			{ code: "ERR_JWT_EXPIRED" }
		);
	});

	test("Should reject a token signed with the wrong key", async () => {
		const otherPair = await generateKeyPair("RS256");

		await assertRejectsWith(
			signTestToken(otherPair.privateKey),
			tokenVerification,
			{ code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" }
		);
	});

	test("Should reject a token with the wrong issuer", async () => {
		await assertRejectsOnClaim(
			signTestToken(privateKey, {}, { issuer: "https://not-the-issuer.com" }),
			"iss"
		);
	});

	test("Should reject a token with the wrong audience", async () => {
		await assertRejectsOnClaim(
			signTestToken(privateKey, {}, { audience: "not-the-audience" }),
			"aud"
		);
	});

	test("Should reject a token signed with a disallowed algorithm", async () => {
		const { privateKey: pssKey } = await generateKeyPair("PS256");

		await assertRejectsWith(
			signTestToken(pssKey, {}, { algorithm: "PS256" }),
			tokenVerification,
			{ code: "ERR_JOSE_ALG_NOT_ALLOWED" }
		);
	});

	test("Should reject a token whose key is not in the key set", async () => {
		await assertRejectsWith(
			signTestToken(privateKey, {}, { keyId: "not-in-the-jwks" }),
			tokenVerification,
			{ code: "ERR_JWKS_NO_MATCHING_KEY" }
		);
	});

	test("Should reject a malformed token", async () => {
		await assertRejectsWith("not-a-jwt", tokenVerification, {
			code: "ERR_JWS_INVALID"
		});
	});

	// jose checks exp only when a token has one, so without it a token never
	// expires. Every other claim is present, so exp is the one missing.
	test("Should reject a token without an expiry", async () => {
		await assertRejectsOnClaim(
			signTestToken(
				privateKey,
				{
					sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
					azp: "banking-service",
					scope: "read write"
				},
				{ expiresIn: null }
			),
			"exp"
		);
	});

	test("Should reject a token that is not valid yet", async () => {
		await assertRejectsOnClaim(
			signTestToken(privateKey, {}, { notBefore: "10m" }),
			"nbf"
		);
	});
});

// A key set that cannot be fetched is the identity provider's failure, not the
// caller's token: its own error, so the auth hook can answer 503, not 401.
suite("Token Verifier with a key set it cannot fetch", () => {
	test("an identity provider that refuses the connection", async () => {
		// Nothing listens on port 1, so the connection is refused at once
		await assertRejectsWith(
			signTestToken(privateKey),
			buildRemoteVerification("http://127.0.0.1:1/certs"),
			{ name: "KeySetUnavailableError" }
		);
	});

	test("an identity provider that answers other than 200", async () => {
		const identityProvider = createServer(answerUnavailable);
		identityProvider.listen(0, "127.0.0.1");
		await once(identityProvider, "listening");
		const { port } = identityProvider.address() as AddressInfo;

		try {
			await assertRejectsWith(
				signTestToken(privateKey),
				buildRemoteVerification(`http://127.0.0.1:${port}/certs`),
				{ name: "KeySetUnavailableError" }
			);
		} finally {
			identityProvider.close();
		}
	});
});

suite("parseClaims", () => {
	test("returns the claims when sub, azp and scope are present strings", () => {
		const claims = parseClaims({
			sub: "user-123",
			azp: "banking-service",
			scope: "read write"
		});

		assert.equal(claims.sub, "user-123");
		assert.equal(claims.azp, "banking-service");
		assert.equal(claims.scope, "read write");
	});

	test("rejects a payload missing sub", () => {
		assert.deepEqual(
			readClaimIssuePaths({ azp: "banking-service", scope: "read write" }),
			[["sub"]]
		);
	});

	test("rejects a payload missing azp, the client the token was issued to", () => {
		assert.deepEqual(
			readClaimIssuePaths({ sub: "user-123", scope: "read write" }),
			[["azp"]]
		);
	});

	test("rejects a payload missing scope", () => {
		assert.deepEqual(
			readClaimIssuePaths({ sub: "user-123", azp: "banking-service" }),
			[["scope"]]
		);
	});

	test("rejects a payload where scope is not a string", () => {
		assert.deepEqual(
			readClaimIssuePaths({
				sub: "user-123",
				azp: "banking-service",
				scope: ["read", "write"]
			}),
			[["scope"]]
		);
	});
});

suite("buildAuthContext", () => {
	test("the client is azp, not the service-account sub; scope becomes an array", () => {
		const authContext = buildAuthContext({
			sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
			azp: "banking-service",
			scope: "read write"
		});

		assert.deepEqual(authContext, {
			clientId: "banking-service",
			scope: ["read", "write"]
		});
	});
});

suite("hasRequiredScopes", () => {
	const authContext = { clientId: "user-123", scope: ["read", "write"] };

	test("returns true when every required scope is present", () => {
		assert.equal(hasRequiredScopes(authContext, ["read"]), true);
	});

	test("returns false when a required scope is missing", () => {
		assert.equal(hasRequiredScopes(authContext, ["read", "delete"]), false);
	});
});
