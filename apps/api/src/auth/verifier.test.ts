import assert from "node:assert/strict";
import { before, suite, test } from "node:test";
import { generateKeyPair } from "jose";
import {
	InvalidClaimsError,
	TokenVerificationError,
	type TokenVerificationReason
} from "#src/errors/auth-errors.ts";
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

let privateKey: CryptoKey;
let tokenVerification: TokenVerification;

async function assertRejectsWithReason(
	token: Promise<string> | string,
	reason: TokenVerificationReason
) {
	await assert.rejects(
		async () => verifyToken(await token, tokenVerification),
		(error: unknown) => {
			assert.ok(error instanceof TokenVerificationError);
			assert.equal(error.reason, reason);
			return true;
		}
	);
}

suite("Token Verifier", () => {
	before(async () => {
		({ privateKey, tokenVerification } = await buildTestSigningKeys());
	});

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
		await assertRejectsWithReason(
			signTestToken(privateKey, {}, { expiresIn: "-1s" }),
			"expired"
		);
	});

	test("Should reject a token signed with the wrong key", async () => {
		const otherPair = await generateKeyPair("RS256");

		await assertRejectsWithReason(
			signTestToken(otherPair.privateKey),
			"signature"
		);
	});

	test("Should reject a token with the wrong issuer", async () => {
		await assertRejectsWithReason(
			signTestToken(privateKey, {}, { issuer: "https://not-the-issuer.com" }),
			"issuer"
		);
	});

	test("Should reject a token with the wrong audience", async () => {
		await assertRejectsWithReason(
			signTestToken(privateKey, {}, { audience: "not-the-audience" }),
			"audience"
		);
	});

	test("Should reject a token signed with a disallowed algorithm", async () => {
		const { privateKey: pssKey } = await generateKeyPair("PS256");

		await assertRejectsWithReason(
			signTestToken(pssKey, {}, { algorithm: "PS256" }),
			"algorithm"
		);
	});

	test("Should reject a token whose key is not in the key set", async () => {
		await assertRejectsWithReason(
			signTestToken(privateKey, {}, { keyId: "not-in-the-jwks" }),
			"unknown-key"
		);
	});

	test("Should reject a malformed token", async () => {
		await assertRejectsWithReason("not-a-jwt", "malformed");
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
		assert.throws(
			() => parseClaims({ azp: "banking-service", scope: "read write" }),
			(error: unknown) => {
				assert.ok(error instanceof TokenVerificationError);
				assert.equal(error.reason, "missing-claims");
				return true;
			}
		);
	});

	test("rejects a payload missing azp, the client the token was issued to", () => {
		assert.throws(
			() => parseClaims({ sub: "user-123", scope: "read write" }),
			(error: unknown) => {
				assert.ok(error instanceof InvalidClaimsError);
				const [issue] = error.issues as { path: unknown }[];
				assert.deepEqual(issue?.path, ["azp"]);
				return true;
			}
		);
	});

	test("rejects a payload missing scope", () => {
		assert.throws(
			() => parseClaims({ sub: "user-123", azp: "banking-service" }),
			(error: unknown) => {
				assert.ok(error instanceof TokenVerificationError);
				assert.equal(error.reason, "missing-claims");
				return true;
			}
		);
	});

	test("rejects a payload where scope is not a string", () => {
		assert.throws(
			() =>
				parseClaims({
					sub: "user-123",
					azp: "banking-service",
					scope: ["read", "write"]
				}),
			(error: unknown) => {
				assert.ok(error instanceof TokenVerificationError);
				assert.equal(error.reason, "missing-claims");
				return true;
			}
		);
	});

	test("carries the zod issues on the thrown error", () => {
		assert.throws(
			() => parseClaims({ azp: "banking-service", scope: "read write" }),
			(error: unknown) => {
				assert.ok(error instanceof InvalidClaimsError);
				assert.equal(error.issues.length, 1);
				const [issue] = error.issues as { path: unknown }[];
				assert.deepEqual(issue?.path, ["sub"]);
				return true;
			}
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
