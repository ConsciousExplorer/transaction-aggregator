import { errors } from "jose";

export type TokenVerificationReason =
	| "malformed"
	| "signature"
	| "expired"
	| "not-yet-valid"
	| "issuer"
	| "audience"
	| "algorithm"
	| "unknown-key"
	| "missing-claims"
	| "key-set-unavailable";

export class TokenVerificationError extends Error {
	reason: TokenVerificationReason;

	constructor(
		message: string,
		reason: TokenVerificationReason,
		options?: ErrorOptions
	) {
		super(message, options);
		this.reason = reason;
	}
}

export class InvalidClaimsError extends TokenVerificationError {
	issues: unknown[];

	constructor(
		issues: unknown[] = [],
		message = "Missing or malformed required claims"
	) {
		super(message, "missing-claims");
		this.issues = issues;
	}
}

// What jose throws when it could not get the signing keys: the fetch timed out
// (ERR_JWKS_TIMEOUT), the answer was not a 200 or not JSON (the generic
// ERR_JOSE_GENERIC), or the JSON was not a key set (ERR_JWKS_INVALID).
const KEY_SET_FAILURE_CODES = new Set([
	"ERR_JWKS_TIMEOUT",
	"ERR_JOSE_GENERIC",
	"ERR_JWKS_INVALID"
]);

/**
 * The identity provider failed, not the caller's token. Besides jose's own
 * key set errors, that is anything that is not a JOSE error at all, such as
 * the TypeError fetch throws when the connection is refused.
 */
function isKeySetFailure(error: unknown) {
	if (!(error instanceof errors.JOSEError)) return true;
	return KEY_SET_FAILURE_CODES.has(error.code);
}

/** By the claim jose names, never by the wording of its message */
function translateClaimFailure(error: errors.JWTClaimValidationFailed) {
	const options = { cause: error };

	if (error.claim === "aud") {
		return new TokenVerificationError("Wrong audience", "audience", options);
	}
	if (error.claim === "iss") {
		return new TokenVerificationError("Wrong issuer", "issuer", options);
	}
	if (error.claim === "nbf") {
		return new TokenVerificationError(
			"Token not valid yet",
			"not-yet-valid",
			options
		);
	}
	if (error.reason === "missing") {
		return new TokenVerificationError(
			`Missing ${error.claim} claim`,
			"missing-claims",
			options
		);
	}
	return new TokenVerificationError("Malformed token", "malformed", options);
}

// Map known jose errors. Always keep internal
// error types: https://github.com/panva/jose/blob/main/docs/util/errors/README.md
export function translateJoseError(error: unknown) {
	const options = { cause: error };

	if (isKeySetFailure(error)) {
		return new TokenVerificationError(
			"Signing keys unavailable",
			"key-set-unavailable",
			options
		);
	}
	if (error instanceof errors.JWTExpired) {
		return new TokenVerificationError("Token expired", "expired", options);
	}
	if (error instanceof errors.JWSSignatureVerificationFailed) {
		return new TokenVerificationError("Bad signature", "signature", options);
	}
	if (error instanceof errors.JOSEAlgNotAllowed) {
		return new TokenVerificationError(
			"Disallowed algorithm",
			"algorithm",
			options
		);
	}
	if (error instanceof errors.JWKSNoMatchingKey) {
		return new TokenVerificationError(
			"Unknown signing key",
			"unknown-key",
			options
		);
	}
	if (error instanceof errors.JWTClaimValidationFailed) {
		return translateClaimFailure(error);
	}
	return new TokenVerificationError("Malformed token", "malformed", options);
}
