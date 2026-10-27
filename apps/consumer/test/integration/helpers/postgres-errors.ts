// SQLSTATE codes the tests expect
// https://www.postgresql.org/docs/current/errcodes-appendix.html
export const CHECK_VIOLATION = "23514";

/**
 * The SQLSTATE of a failed query. The consumer wraps the driver's error in its
 * own, so the code sits further down the cause chain.
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
