import assert from "node:assert";
import { mock, suite, test } from "node:test";
import { DatabaseError, type Pool } from "pg";
import {
	buildCardRecord,
	castToDomainTransaction
} from "#src/domain/test-records.ts";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import { createTransactionIngester } from "#src/services/transaction-ingester.ts";
import { insertDurationSeconds } from "#src/telemetry/metrics.ts";

// No rules, so every transaction takes the fallback verdict.
const EMPTY_RULESET = { version: 1, rules: [], uncategorisedId: 1 };

/** A pool whose INSERT fails as Postgres would fail it, with the given SQLSTATE. */
function buildPoolFailingInsert(code: string) {
	return {
		async query() {
			const error = new DatabaseError(`server error ${code}`, 0, "error");
			error.code = code;
			throw error;
		}
	} as unknown as Pool;
}

/** The histogram is a process-wide singleton, so tests compare before/after. */
async function countInsertDurationObservations() {
	const metric = await insertDurationSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "insert_duration_seconds_count") {
			return value.value;
		}
	}
	return 0;
}

suite("transaction ingestion", () => {
	test("a valid transaction is inserted in one statement", async () => {
		const query = mock.fn(async (_text: string, _values?: unknown[]) => ({
			rows: [],
			rowCount: 1
		}));
		const pool = { query } as unknown as Pool;

		const ingestTransactions = createTransactionIngester(
			"card",
			EMPTY_RULESET,
			pool
		);

		const outcome = await ingestTransactions([
			castToDomainTransaction(buildCardRecord())
		]);

		assert.deepEqual(outcome, { attempted: 1, inserted: 1 });

		assert.equal(query.mock.callCount(), 1);
		assert.match(
			query.mock.calls[0]?.arguments[0] ?? "",
			/INSERT INTO txn_agg\.transactions/
		);
	});

	// The batch handler dead-letters a non-retryable failure row by row and
	// then commits, so a failure every row shares must be retryable instead.
	test("a read-only standby (25006) fails the insert as retryable", async () => {
		const ingestTransactions = createTransactionIngester(
			"card",
			EMPTY_RULESET,
			buildPoolFailingInsert("25006")
		);

		await assert.rejects(
			ingestTransactions([castToDomainTransaction(buildCardRecord())]),
			RetryableError
		);
	});

	test("a failed insert is still timed, so a slow failure shows in the histogram", async () => {
		const ingestTransactions = createTransactionIngester(
			"card",
			EMPTY_RULESET,
			buildPoolFailingInsert("57014")
		);
		const before = await countInsertDurationObservations();

		await assert.rejects(
			ingestTransactions([castToDomainTransaction(buildCardRecord())])
		);

		assert.equal(await countInsertDurationObservations(), before + 1);
	});

	test("a row a CHECK constraint refuses (23514) fails the insert as non-retryable", async () => {
		const ingestTransactions = createTransactionIngester(
			"card",
			EMPTY_RULESET,
			buildPoolFailingInsert("23514")
		);

		await assert.rejects(
			ingestTransactions([castToDomainTransaction(buildCardRecord())]),
			NonRetryableError
		);
	});
});
