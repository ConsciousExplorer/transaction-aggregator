// SQLSTATE codes the tests expect
// https://www.postgresql.org/docs/current/errcodes-appendix.html
export const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * The SQLSTATE of a failed query. drizzle wraps the driver's error, so the
 * code sits on the error's cause.
 */
export function readPostgresErrorCode(error: unknown) {
	let current = error;
	while (typeof current === "object" && current !== null) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") return code;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}
