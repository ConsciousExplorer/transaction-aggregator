import { NonRetryableError, RetryableError } from "./consumer-errors.ts";

const RETRYABLE_CLASSES = new Set([
	"08", // connection exception
	"53", // insufficient resources
	"58" // system error external to Postgres
]);

const RETRYABLE_CODES = new Set([
	"40001", // serialization_failure
	"40P01", // deadlock_detected
	"40000", // transaction_rollback
	"55006", // object_in_use
	"55P03", // lock_not_available
	"57014", // query_canceled
	"57P01", // admin_shutdown
	"57P02", // crash_shutdown
	"57P03" // cannot_connect_now
]);

/** Socket-level failures, which arrive without a SQLSTATE. */
const RETRYABLE_SYSCALLS = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EPIPE",
	"ETIMEDOUT",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND"
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

export function isRetryablePostgresCode(code: string): boolean {
	return RETRYABLE_CODES.has(code) || RETRYABLE_CLASSES.has(code.slice(0, 2));
}

function diagnostics(error: Record<string, unknown>): Record<string, unknown> {
	const details: Record<string, unknown> = {};

	for (const field of PG_DIAGNOSTIC_FIELDS) {
		if (error[field] !== undefined) details[field] = error[field];
	}

	return details;
}

export function classifyPostgresError(
	error: unknown,
	message = "Postgres operation failed"
): RetryableError | NonRetryableError {
	// Already classified upstream — don't re-wrap and lose the original context.
	if (error instanceof RetryableError || error instanceof NonRetryableError) {
		return error;
	}

	if (typeof error !== "object" || error === null) {
		return new NonRetryableError(message, { cause: error });
	}

	const candidate = error as Record<string, unknown>;
	const code = typeof candidate.code === "string" ? candidate.code : undefined;
	const details = diagnostics(candidate);
	const reason =
		error instanceof Error ? `${message}: ${error.message}` : message;

	if (code && (isRetryablePostgresCode(code) || RETRYABLE_SYSCALLS.has(code))) {
		return new RetryableError(reason, { cause: error, details });
	}

	// No SQLSTATE and no syscall means the connection died mid-flight rather
	// than the server rejecting the statement — pg surfaces these as plain
	// Errors ("Connection terminated unexpectedly", pool acquisition timeouts).
	if (!code && error instanceof Error) {
		return new RetryableError(reason, { cause: error, details });
	}

	return new NonRetryableError(reason, { cause: error, details });
}
