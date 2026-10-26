import { errors } from "jose";

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
export function isKeySetFailure(error: unknown) {
	if (!(error instanceof errors.JOSEError)) return true;
	return KEY_SET_FAILURE_CODES.has(error.code);
}

/**
 * The signing keys could not be fetched, so no token could be checked. It is
 * the one verification failure answered differently: 503, not 401. Every other
 * failure is the caller's token, and jose's own error says what was wrong.
 */
export class KeySetUnavailableError extends Error {
	constructor(options: ErrorOptions) {
		super("Signing keys unavailable", options);
		this.name = "KeySetUnavailableError";
	}
}
