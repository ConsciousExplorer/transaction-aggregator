/** biome-ignore-all lint/style/noNonNullAssertion: tests can be null */
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
import type { CardTransaction } from "#src/schemas/card.ts";
import { ingestLagSeconds } from "#src/telemetry/metrics.ts";
import {
	type ClassifiedMessage,
	createTransactionBatchHandler,
	type DeadLetterFailure,
	type ValidMessage
} from "./transactionBatchHandler.ts";

// The producer's partition key
const CUSTOMER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// No rules, so every row takes the fallback category. The policy under test
// doesn't depend on which category a row gets.
const EMPTY_RULESET = { version: 1, rules: [], uncategorisedId: 1 };

// SQLSTATE 23514: a row that violates a CHECK, which fails the same way on
// every retry
const CHECK_VIOLATION = "23514";

type PoolQuery = (
	text: string,
	values?: unknown[]
) => Promise<{ rows: unknown[]; rowCount: number }>;

/** A real card record, so the handler runs the real normaliser on it. */
function buildValidMessage(
	externalId: string,
	offset: number,
	over: Partial<CardTransaction> = {}
): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: CUSTOMER_ID,
		recordTimestamp: Date.now(),
		headers: new Map(),
		kind: "valid",
		value: castToDomainTransaction(
			buildCardRecord({ transactionId: externalId, ...over })
		),
		raw: Buffer.from(`avro bytes ${externalId}`)
	};
}

function buildPoisonMessage(offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: CUSTOMER_ID,
		recordTimestamp: Date.now(),
		headers: new Map(),
		kind: "poison",
		raw: Buffer.from("not avro"),
		error: new Error("bad magic byte")
	};
}

function buildTombstoneMessage(offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: CUSTOMER_ID,
		recordTimestamp: Date.now(),
		headers: new Map(),
		kind: "tombstone"
	};
}

/** The rows an INSERT was given, by external id, read out of its one JSON parameter. */
function readInsertedExternalIds(values: unknown[] | undefined) {
	const rows = JSON.parse(String(values?.[0])) as { external_id: string }[];
	const externalIds: string[] = [];
	for (const row of rows) {
		externalIds.push(row.external_id);
	}
	return externalIds;
}

function readExternalId(message: DeadLetterFailure["message"]) {
	return (message as ValidMessage).value.transactionId;
}

function buildCheckViolation() {
	const error = new DatabaseError(
		"new row violates check constraint",
		0,
		"error"
	);
	error.code = CHECK_VIOLATION;
	return error;
}

/** The histogram is a process-wide singleton, so tests compare before/after. */
async function countIngestLagObservations() {
	const metric = await ingestLagSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "ingest_lag_seconds_count") return value.value;
	}
	return 0;
}

// Fake pools, one per way Postgres can answer the INSERT. A test wraps the
// one it needs in mock.fn to count the statements sent.

/** Every row lands. */
async function insertEveryRow(_text: string, values?: unknown[]) {
	return { rows: [], rowCount: readInsertedExternalIds(values).length };
}

/** Any statement that carries row "b" is refused, as a CHECK would refuse it. */
async function refuseRowB(text: string, values?: unknown[]) {
	if (readInsertedExternalIds(values).includes("b"))
		throw buildCheckViolation();
	return insertEveryRow(text, values);
}

/** A connection failure is not a DatabaseError, so it is never a bad row. */
async function loseConnection(): Promise<never> {
	throw new Error("read ECONNRESET");
}

/** The batch is refused for a row, then the connection dies during isolation. */
async function refuseBatchThenLoseConnection(
	_text: string,
	values?: unknown[]
): Promise<never> {
	if (readInsertedExternalIds(values).length > 1) throw buildCheckViolation();
	throw new Error("read ECONNRESET");
}

function buildPool(query: PoolQuery) {
	return { query } as unknown as Pool;
}

async function acceptDeadLetters(_failures: DeadLetterFailure[]) {}

suite("transaction batch handler", () => {
	test("prepares each record and inserts the batch in one statement when nothing fails", async () => {
		const query = mock.fn(insertEveryRow);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2)
		]);

		assert.equal(
			query.mock.callCount(),
			1,
			"one batch insert, not per-message"
		);
		assert.deepEqual(
			readInsertedExternalIds(query.mock.calls[0]!.arguments[1]),
			["a", "b"]
		);
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 0);
	});

	test("dead-letters poison without inserting it", async () => {
		const query = mock.fn(insertEveryRow);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildPoisonMessage(2),
			buildTombstoneMessage(3)
		]);

		assert.equal(query.mock.callCount(), 1);
		assert.deepEqual(
			readInsertedExternalIds(query.mock.calls[0]!.arguments[1]),
			["a"],
			"only the valid message"
		);
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 1);
		assert.equal(sendToDeadLetterQueue.mock.calls[0]!.arguments[0].length, 1);
	});

	// A record the normaliser refuses is known before any SQL runs, so it costs
	// itself alone: the rest of the batch still goes in one statement.
	test("dead-letters a record that can't become a row, and inserts the rest in one batch", async () => {
		const query = mock.fn(insertEveryRow);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2, { customerId: "not-a-uuid" }),
			buildValidMessage("c", 3)
		]);

		assert.equal(query.mock.callCount(), 1, "no row-by-row retry");
		assert.deepEqual(
			readInsertedExternalIds(query.mock.calls[0]!.arguments[1]),
			["a", "c"]
		);
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 1);
		const failure = sendToDeadLetterQueue.mock.calls[0]!.arguments[0][0]!;
		assert.equal(failure.message.kind, "valid");
		assert.equal(readExternalId(failure.message), "b");
		assert.ok(
			failure.error instanceof NonRetryableError,
			"the error the normaliser threw travels with it"
		);
	});

	test("isolates a row the database refuses instead of losing the batch", async () => {
		const query = mock.fn(refuseRowB);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2),
			buildValidMessage("c", 3)
		]);

		// 1 refused batch + 3 single-row statements
		assert.equal(query.mock.callCount(), 4);
		assert.equal(
			sendToDeadLetterQueue.mock.callCount(),
			1,
			"only the offending row is dead-lettered"
		);
		const failure = sendToDeadLetterQueue.mock.calls[0]!.arguments[0][0]!;
		assert.equal(failure.message.kind, "valid");
		assert.equal(
			readExternalId(failure.message),
			"b",
			"the dead-lettered row is the one that failed, not a bystander"
		);
		assert.ok(failure.error instanceof NonRetryableError);
		assert.equal(
			failure.error.details.code,
			CHECK_VIOLATION,
			"the SQLSTATE travels with it"
		);
	});

	test("observes ingest lag once per committed row, none for failed ones", async () => {
		const before = await countIngestLagObservations();
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(refuseRowB),
			acceptDeadLetters
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2),
			buildValidMessage("c", 3)
		]);

		assert.equal(
			(await countIngestLagObservations()) - before,
			2,
			"a and c committed; the refused batch and row b add nothing"
		);
	});

	test("rethrows a retryable batch failure so offsets are not committed", async () => {
		const query = mock.fn(loseConnection);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await assert.rejects(
			handleTransactionBatch([buildValidMessage("a", 1)]),
			RetryableError,
			"a broken world must replay, not dead-letter"
		);

		assert.equal(query.mock.callCount(), 1, "no per-row isolation attempted");
		assert.equal(
			sendToDeadLetterQueue.mock.callCount(),
			0,
			"good data must never be dead-lettered"
		);
	});

	test("rethrows a retryable failure raised during isolation", async () => {
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(refuseBatchThenLoseConnection),
			sendToDeadLetterQueue
		);

		await assert.rejects(
			handleTransactionBatch([
				buildValidMessage("a", 1),
				buildValidMessage("b", 2)
			]),
			RetryableError
		);

		assert.equal(sendToDeadLetterQueue.mock.callCount(), 0);
	});

	test("still dead-letters poison when there is no valid data", async () => {
		const query = mock.fn(insertEveryRow);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);
		const handleTransactionBatch = createTransactionBatchHandler(
			"card",
			EMPTY_RULESET,
			buildPool(query),
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildPoisonMessage(1),
			buildTombstoneMessage(2)
		]);

		assert.equal(query.mock.callCount(), 0, "nothing to insert");
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 1);
	});
});
