import { DatabaseError } from "pg";
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

/**
 * Only the server answers with a SQLSTATE. A connection that fails carries a
 * syscall code (ECONNREFUSED, ECONNRESET) or none at all, and is never a bad row.
 */
function isBadRowError(error: unknown) {
	if (!(error instanceof DatabaseError) || error.code === undefined) {
		return false;
	}
	return BAD_ROW_CLASSES.has(error.code.slice(0, 2));
}

function extractDiagnostics(error: unknown) {
	const details: Record<string, unknown> = {};
	if (!(error instanceof Error)) return details;

	const fields = error as Error & Record<string, unknown>;
	for (const field of PG_DIAGNOSTIC_FIELDS) {
		if (fields[field] !== undefined) details[field] = fields[field];
	}

	return details;
}

export function classifyPostgresError(
	error: unknown,
	message = "Postgres operation failed"
) {
	const reason =
		error instanceof Error ? `${message}: ${error.message}` : message;
	const details = extractDiagnostics(error);

	if (isBadRowError(error)) {
		return new NonRetryableError(reason, { cause: error, details });
	}

	// Every other failure is the database or the connection, and fails every
	// row alike
	return new RetryableError(reason, { cause: error, details });
}
