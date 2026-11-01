import assert from "node:assert";
import { mock, suite, test } from "node:test";
import { DatabaseError, type Pool } from "pg";
import { compileRules } from "#src/domain/rule-categoriser.ts";
import {
	buildCardRecord,
	castToDomainTransaction
} from "#src/domain/test-records.ts";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import {
	insertTransactions,
	prepareTransaction
} from "#src/services/transaction-ingester.ts";
import {
	categorisationVerdictsTotal,
	insertDurationSeconds
} from "#src/telemetry/metrics.ts";

// No rules, so every transaction takes the fallback verdict.
const NO_RULES = compileRules({ version: 1, rules: [], uncategorisedId: 1 });

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

/** A pool whose INSERT reports that every row landed. */
function buildPoolInsertingAll(rowCount: number) {
	return {
		async query() {
			return { rows: [], rowCount };
		}
	} as unknown as Pool;
}

/** A card row as preparation makes it, ready to insert. */
function buildPreparedCardRow() {
	return prepareTransaction(
		castToDomainTransaction(buildCardRecord()),
		"card",
		NO_RULES
	);
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

/** The counter is labelled by matcher, and these rows all take the fallback. */
async function countFallbackVerdicts() {
	const metric = await categorisationVerdictsTotal.get();
	for (const value of metric.values) {
		if (value.labels.matcher_type === "fallback") return value.value;
	}
	return 0;
}

suite("transaction preparation", () => {
	test("a valid record becomes a categorised row that carries its verdict", () => {
		const row = prepareTransaction(
			castToDomainTransaction(buildCardRecord()),
			"card",
			NO_RULES
		);

		assert.equal(row.externalId, "txn-0001");
		assert.equal(row.categoryId, 1, "no rules, so the fallback category");
		assert.equal(row.matcherType, "fallback");
	});

	// The batch handler dead-letters the record alone on this error, before
	// anything in the batch reaches the database.
	test("a record the normaliser refuses throws non-retryable", () => {
		assert.throws(
			() =>
				prepareTransaction(
					castToDomainTransaction(
						buildCardRecord({ customerId: "not-a-uuid" })
					),
					"card",
					NO_RULES
				),
			NonRetryableError
		);
	});
});

suite("transaction insertion", () => {
	test("a batch is inserted in one statement", async () => {
		const query = mock.fn(async (_text: string, _values?: unknown[]) => ({
			rows: [],
			rowCount: 2
		}));

		const outcome = await insertTransactions(
			[buildPreparedCardRow(), buildPreparedCardRow()],
			{ query } as unknown as Pool
		);

		assert.deepEqual(outcome, { attempted: 2, inserted: 2 });
		assert.equal(query.mock.callCount(), 1);
		assert.match(
			query.mock.calls[0]?.arguments[0] ?? "",
			/INSERT INTO txn_agg\.transactions/
		);
	});

	// Counted after the insert, so a batch that fails and is retried one row
	// at a time is not counted twice.
	test("records one verdict per row once the insert landed, none when it failed", async () => {
		const before = await countFallbackVerdicts();

		await insertTransactions(
			[buildPreparedCardRow(), buildPreparedCardRow()],
			buildPoolInsertingAll(2)
		);
		assert.equal(await countFallbackVerdicts(), before + 2);

		await assert.rejects(
			insertTransactions(
				[buildPreparedCardRow()],
				buildPoolFailingInsert("23514")
			)
		);
		assert.equal(await countFallbackVerdicts(), before + 2);
	});

	test("a failed insert is still timed, so a slow failure shows in the histogram", async () => {
		const before = await countInsertDurationObservations();

		await assert.rejects(
			insertTransactions(
				[buildPreparedCardRow()],
				buildPoolFailingInsert("57014")
			)
		);

		assert.equal(await countInsertDurationObservations(), before + 1);
	});
});
