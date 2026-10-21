import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { DatabaseError } from "pg";
import { NonRetryableError, RetryableError } from "./consumer-errors.ts";
import { classifyPostgresError } from "./postgres.ts";

/** The error pg rejects a query with when the server answers with an error. */
function buildDatabaseError(code: string) {
	const error = new DatabaseError(`server error ${code}`, 0, "error");
	error.code = code;
	return error;
}

// Failures of the database or the connection: every row of every batch hits
// them alike, so they must end the process uncommitted, never dead-letter.
const ENVIRONMENT_FAILURES = [
	{ code: "25006", cause: "a read-only standby during a failover" },
	{ code: "28P01", cause: "a rotated database password" },
	{ code: "42501", cause: "a missing INSERT grant" },
	{ code: "3D000", cause: "a renamed database" },
	{ code: "57P01", cause: "an administrator shutdown" },
	{ code: "40P01", cause: "a deadlock" },
	{ code: "08006", cause: "a connection failure" }
];

// Failures of one row: the same row fails the same way on every retry.
const BAD_ROW_FAILURES = [
	{ code: "23514", cause: "a CHECK violation" },
	{ code: "23503", cause: "a foreign key violation" },
	{ code: "22003", cause: "a numeric value out of range" },
	{ code: "22P02", cause: "an invalid text representation" }
];

suite("classifyPostgresError", () => {
	for (const failure of ENVIRONMENT_FAILURES) {
		test(`retries ${failure.code}, ${failure.cause}`, () => {
			const classified = classifyPostgresError(
				buildDatabaseError(failure.code)
			);

			assert.ok(classified instanceof RetryableError);
		});
	}

	for (const failure of BAD_ROW_FAILURES) {
		test(`does not retry ${failure.code}, ${failure.cause}`, () => {
			const classified = classifyPostgresError(
				buildDatabaseError(failure.code)
			);

			assert.ok(classified instanceof NonRetryableError);
		});
	}

	test("retries a socket failure, which carries a syscall code instead of a SQLSTATE", () => {
		const socketFailure = Object.assign(new Error("read ECONNRESET"), {
			code: "ECONNRESET",
			syscall: "read"
		});

		assert.ok(classifyPostgresError(socketFailure) instanceof RetryableError);
	});

	test("retries an error with no code, a connection that died mid-statement", () => {
		const connectionLost = new Error("Connection terminated unexpectedly");

		assert.ok(classifyPostgresError(connectionLost) instanceof RetryableError);
	});

	test("keeps the driver's error as the cause and its diagnostics as details", () => {
		const error = buildDatabaseError("23514");
		error.constraint = "transactions_amount_minor_check";

		const classified = classifyPostgresError(error, "Batch insert failed");

		assert.strictEqual(classified.cause, error);
		assert.strictEqual(classified.details.code, "23514");
		assert.strictEqual(
			classified.details.constraint,
			"transactions_amount_minor_check"
		);
		assert.match(classified.message, /^Batch insert failed: /);
	});

	test("returns an error that is already classified unchanged", () => {
		const classified = new RetryableError("connection died");

		assert.strictEqual(classifyPostgresError(classified), classified);
	});
});
