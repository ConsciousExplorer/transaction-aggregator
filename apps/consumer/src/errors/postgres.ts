import { NonRetryableError, RetryableError } from "./consumer-errors.ts";

/**
 * The SQLSTATE classes that describe the row itself: a value Postgres cannot
 * store (22, data exception) or one a constraint refuses (23, integrity
 * constraint violation). The same row fails the same way on every retry, so it
 * is dead-lettered. Every other code describes the database or the connection
 * (a read-only standby, a rotated password, a missing grant, a lock, a
 * shutdown) and fails every row alike: dead-lettering those would move the
 * whole topic into the DLQ and commit past it.
 */
const BAD_ROW_CLASSES = new Set([
	"22", // data exception
	"23" // integrity constraint violation
]);

/** pg's DatabaseError carries the diagnostics on the error itself. */
const PG_DIAGNOSTIC_FIELDS = [
	"code",
	"constraint",
	"column",
	"table",
	"schema",
	"detail",
	"routine",
	"severity"
] as const;

function isBadRowPostgresCode(code: string) {
	return BAD_ROW_CLASSES.has(code.slice(0, 2));
}

function extractDiagnostics(error: Record<string, unknown>) {
	const details: Record<string, unknown> = {};

	for (const field of PG_DIAGNOSTIC_FIELDS) {
		if (error[field] !== undefined) details[field] = error[field];
	}

	return details;
}

export function classifyPostgresError(
	error: unknown,
	message = "Postgres operation failed"
) {
	// Already classified upstream — don't re-wrap and lose the original context.
	if (error instanceof RetryableError || error instanceof NonRetryableError) {
		return error;
	}

	if (typeof error !== "object" || error === null) {
		return new NonRetryableError(message, { cause: error });
	}

	const candidate = error as Record<string, unknown>;
	const code = typeof candidate.code === "string" ? candidate.code : undefined;
	const details = extractDiagnostics(candidate);
	const reason =
		error instanceof Error ? `${message}: ${error.message}` : message;

	if (code && isBadRowPostgresCode(code)) {
		return new NonRetryableError(reason, { cause: error, details });
	}

	// Every other SQLSTATE, and the socket failures that carry a syscall code
	// in its place (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ...).
	if (code) {
		return new RetryableError(reason, { cause: error, details });
	}

	// No code at all means the connection died mid-flight rather than the
	// server rejecting the statement — pg surfaces these as plain Errors
	// ("Connection terminated unexpectedly", pool acquisition timeouts).
	if (error instanceof Error) {
		return new RetryableError(reason, { cause: error, details });
	}

	return new NonRetryableError(reason, { cause: error, details });
}
