import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

// Real keys and signed tokens for tests, so every auth test goes through
// `verifyToken` rather than a fake. Not a .test.ts file, so the test runner
// does not run it as a suite.

export const TEST_ISSUER = "https://unit-test.com";
export const TEST_AUDIENCE = "unit-test-audience";
const TEST_KEY_ID = "unit-test-key-id";

/** A fresh RS256 key pair, and verification settings that trust its public key. */
export async function buildTestSigningKeys() {
	const pair = await generateKeyPair("RS256");

	const publicKey = await exportJWK(pair.publicKey);
	publicKey.kid = TEST_KEY_ID;
	publicKey.alg = "RS256";

	return {
		privateKey: pair.privateKey,
		tokenVerification: {
			getSigningKey: createLocalJWKSet({ keys: [publicKey] }),
			issuer: TEST_ISSUER,
			audience: TEST_AUDIENCE
		}
	};
}

export interface TestTokenOptions {
	issuer?: string;
	audience?: string;
	algorithm?: string;
	keyId?: string;
	// null leaves the exp claim out
	expiresIn?: string | null;
	notBefore?: string;
}

/** By default a token the keys above accept; each option breaks one check. */
export function signTestToken(
	privateKey: CryptoKey,
	claims: Record<string, unknown> = {},
	{
		issuer = TEST_ISSUER,
		audience = TEST_AUDIENCE,
		algorithm = "RS256",
		keyId = TEST_KEY_ID,
		expiresIn = "5m",
		notBefore
	}: TestTokenOptions = {}
) {
	const token = new SignJWT(claims)
		.setProtectedHeader({ alg: algorithm, kid: keyId })
		.setIssuedAt()
		.setIssuer(issuer)
		.setAudience(audience);

	if (expiresIn !== null) token.setExpirationTime(expiresIn);
	if (notBefore !== undefined) token.setNotBefore(notBefore);

	return token.sign(privateKey);
}
