export type TokenVerificationReason =
	| "malformed"
	| "signature"
	| "expired"
	| "issuer"
	| "audience"
	| "algorithm"
	| "missing-claims";

export class TokenVerificationError extends Error {
	reason: TokenVerificationReason;

	constructor(message: string, reason: TokenVerificationReason) {
		super(message);
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

// Map known jose errors. Always keep internal
// error types: https://github.com/panva/jose/blob/main/docs/util/errors/README.md
export function mapJoseError(err: unknown): TokenVerificationError {
	const name = err instanceof Error ? err.name : "";
	if (name === "JWTExpired")
		return new TokenVerificationError("Token expired", "expired");
	if (name === "JWSSignatureVerificationFailed")
		return new TokenVerificationError("Bad signature", "signature");
	if (name === "JOSEAlgNotAllowed")
		return new TokenVerificationError("Disallowed algorithm", "algorithm");
	if (name === "JWTClaimValidationFailed") {
		const message = err instanceof Error ? err.message : "";
		if (message.includes("aud"))
			return new TokenVerificationError("Wrong audience", "audience");
		return new TokenVerificationError("Wrong issuer", "issuer");
	}
	return new TokenVerificationError("Malformed token", "malformed");
}
