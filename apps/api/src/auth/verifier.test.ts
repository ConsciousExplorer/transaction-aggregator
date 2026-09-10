import assert from "node:assert/strict";
import { before, suite, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
	InvalidClaimsError,
	TokenVerificationError,
	type TokenVerificationReason
} from "#src/errors/auth-errors.ts";
import {
	createTokenVerifier,
	getAuthScopes,
	getContext,
	parseClaims
} from "./verifier.ts";

const ISS = "https://unit-test.com";
const AUD = "unit-test-audience";
const KID = "unit-test-key-id";

let privateKey: CryptoKey;
let verifyToken: ReturnType<typeof createTokenVerifier>;

function signToken(
	claims: Record<string, unknown> = {},
	{
		issuer = ISS,
		audience = AUD,
		alg = "RS256",
		kid = KID,
		expiresIn = "5m",
		key = privateKey
	}: {
		issuer?: string;
		audience?: string;
		alg?: string;
		kid?: string;
		expiresIn?: string;
		key?: CryptoKey;
	} = {}
) {
	return new SignJWT(claims)
		.setProtectedHeader({ alg, kid })
		.setIssuedAt()
		.setIssuer(issuer)
		.setAudience(audience)
		.setExpirationTime(expiresIn)
		.sign(key);
}

async function assertRejectsWithReason(
	token: Promise<string> | string,
	reason: TokenVerificationReason
) {
	await assert.rejects(
		async () => verifyToken(await token),
		(err: unknown) => {
			assert.ok(err instanceof TokenVerificationError);
			assert.equal(err.reason, reason);
			return true;
		}
	);
}

suite("Token Verifier", () => {
	before(async () => {
		const pair = await generateKeyPair("RS256");
		privateKey = pair.privateKey;

		const jwk = await exportJWK(pair.publicKey);
		jwk.kid = KID;
		jwk.alg = "RS256";

		const getKey = createLocalJWKSet({ keys: [jwk] });
		verifyToken = createTokenVerifier(
			{
				jwksUri: "http://unused",
				issuer: ISS,
				audience: AUD
			},
			getKey
		);
	});

	test("should verify a valid token", async () => {
		const token = await signToken({ sub: "user-123", scope: "read write" });

		const claims = await verifyToken(token);

		assert.equal(claims.sub, "user-123");
		assert.equal(claims.scope, "read write");
		assert.equal(claims.iss, ISS);
		assert.equal(claims.aud, AUD);
	});

	// Negative test cases
	test("Should reject an expired token", async () => {
		await assertRejectsWithReason(
			signToken({}, { expiresIn: "-1s" }),
			"expired"
		);
	});

	test("Should reject a token signed with the wrong key", async () => {
		const otherPair = await generateKeyPair("RS256");

		await assertRejectsWithReason(
			signToken({}, { key: otherPair.privateKey }),
			"signature"
		);
	});

	test("Should reject a token with the wrong issuer", async () => {
		await assertRejectsWithReason(
			signToken({}, { issuer: "https://not-the-issuer.com" }),
			"issuer"
		);
	});

	test("Should reject a token with the wrong audience", async () => {
		await assertRejectsWithReason(
			signToken({}, { audience: "not-the-audience" }),
			"audience"
		);
	});

	test("Should reject a token signed with a disallowed algorithm", async () => {
		const { privateKey: hsKey } = await generateKeyPair("PS256");

		await assertRejectsWithReason(
			signToken({}, { alg: "PS256", key: hsKey }),
			"algorithm"
		);
	});

	test("Should reject a malformed token", async () => {
		await assertRejectsWithReason("not-a-jwt", "malformed");
	});
});

suite("parseClaims", () => {
	test("returns the claims when sub and scope are present strings", () => {
		const claims = parseClaims({ sub: "user-123", scope: "read write" });

		assert.equal(claims.sub, "user-123");
		assert.equal(claims.scope, "read write");
	});

	test("rejects a payload missing sub", () => {
		assert.throws(
			() => parseClaims({ scope: "read write" }),
			(err: unknown) => {
				assert.ok(err instanceof TokenVerificationError);
				assert.equal(err.reason, "missing-claims");
				return true;
			}
		);
	});

	test("rejects a payload missing scope", () => {
		assert.throws(
			() => parseClaims({ sub: "user-123" }),
			(err: unknown) => {
				assert.ok(err instanceof TokenVerificationError);
				assert.equal(err.reason, "missing-claims");
				return true;
			}
		);
	});

	test("rejects a payload where scope is not a string", () => {
		assert.throws(
			() => parseClaims({ sub: "user-123", scope: ["read", "write"] }),
			(err: unknown) => {
				assert.ok(err instanceof TokenVerificationError);
				assert.equal(err.reason, "missing-claims");
				return true;
			}
		);
	});

	test("carries the zod issues on the thrown error", () => {
		assert.throws(
			() => parseClaims({ scope: "read write" }),
			(err: unknown) => {
				assert.ok(err instanceof InvalidClaimsError);
				assert.equal(err.issues.length, 1);
				const [issue] = err.issues as { path: unknown }[];
				assert.deepEqual(issue?.path, ["sub"]);
				return true;
			}
		);
	});
});

suite("getContext", () => {
	test("splits the scope claim into an array, keyed by clientId", () => {
		const ctx = getContext({ sub: "user-123", scope: "read write" });

		assert.deepEqual(ctx, { clientId: "user-123", scope: ["read", "write"] });
	});
});

suite("getAuthScopes", () => {
	const ctx = { clientId: "user-123", scope: ["read", "write"] };

	test("returns true when every required scope is present", () => {
		assert.equal(getAuthScopes(ctx, ["read"]), true);
	});

	test("returns false when a required scope is missing", () => {
		assert.equal(getAuthScopes(ctx, ["read", "delete"]), false);
	});
});
