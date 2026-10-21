/** biome-ignore-all lint/style/noNonNullAssertion: tests can be null */
import assert from "node:assert";
import { mock, suite, test } from "node:test";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import { ingestLagSeconds } from "#src/telemetry/metrics.ts";
import {
	type ClassifiedMessage,
	createTransactionBatchHandler,
	type DeadLetterFailure,
	type ValidMessage
} from "./transactionBatchHandler.ts";

// The producer's partition key
const CUSTOMER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function buildValidMessage(
	externalId: string,
	offset: number
): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: CUSTOMER_ID,
		recordTimestamp: Date.now(),
		headers: new Map(),
		kind: "valid",
		// Only `transactionType` and identity matter here — ingestion is faked.
		value: {
			transactionType: "card",
			transactionId: externalId
		} as unknown as DomainTransactionSchema,
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

function readExternalId(transaction: DomainTransactionSchema) {
	return (transaction as unknown as { transactionId: string }).transactionId;
}

/** The histogram is a process-wide singleton, so tests compare before/after. */
async function countIngestLagObservations() {
	const metric = await ingestLagSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "ingest_lag_seconds_count") return value.value;
	}
	return 0;
}

// Fake ingest steps, one per database behaviour a test needs.

async function ingestAll(transactions: DomainTransactionSchema[]) {
	return { attempted: transactions.length, inserted: transactions.length };
}

/** The batch insert fails; retried one at a time, every row lands except "b". */
async function ingestFailingBatchAndRowB(
	transactions: DomainTransactionSchema[]
) {
	if (transactions.length > 1) {
		throw new NonRetryableError("batch violates a constraint");
	}
	if (readExternalId(transactions[0]!) === "b") {
		throw new NonRetryableError("row b violates a constraint");
	}
	return { attempted: 1, inserted: 1 };
}

async function ingestWithLostConnection(
	_transactions: DomainTransactionSchema[]
): Promise<never> {
	throw new RetryableError("connection died");
}

/** The batch insert fails for a row; the connection dies during isolation. */
async function ingestFailingBatchThenLosingConnection(
	transactions: DomainTransactionSchema[]
): Promise<never> {
	if (transactions.length > 1) throw new NonRetryableError("bad batch");
	throw new RetryableError("connection died mid-isolation");
}

async function acceptDeadLetters(_failures: DeadLetterFailure[]) {}

suite("transaction batch handler", () => {
	test("ingests the whole batch in one call when nothing fails", async () => {
		const ingest = mock.fn(ingestAll);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingest,
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2)
		]);

		assert.equal(
			ingest.mock.callCount(),
			1,
			"one batch insert, not per-message"
		);
		assert.equal(ingest.mock.calls[0]!.arguments[0].length, 2);
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 0);
	});

	test("dead-letters poison without sending it to ingestion", async () => {
		const ingest = mock.fn(ingestAll);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingest,
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildPoisonMessage(2),
			buildTombstoneMessage(3)
		]);

		assert.equal(ingest.mock.callCount(), 1);
		assert.equal(
			ingest.mock.calls[0]!.arguments[0].length,
			1,
			"only the valid message"
		);
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 1);
		assert.equal(sendToDeadLetterQueue.mock.calls[0]!.arguments[0].length, 1);
	});

	test("isolates one poison row instead of losing the batch", async () => {
		const ingest = mock.fn(ingestFailingBatchAndRowB);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingest,
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2),
			buildValidMessage("c", 3)
		]);

		// 1 failed batch attempt + 3 single-message retries
		assert.equal(ingest.mock.callCount(), 4);
		assert.equal(
			sendToDeadLetterQueue.mock.callCount(),
			1,
			"only the offending row is dead-lettered"
		);
		const deadLetterMessage =
			sendToDeadLetterQueue.mock.calls[0]!.arguments[0][0]!.message;
		assert.equal(deadLetterMessage.kind, "valid");
		assert.equal(
			readExternalId((deadLetterMessage as ValidMessage).value),
			"b",
			"the dead-lettered row is the one that failed, not a bystander"
		);
	});

	test("observes ingest lag once per committed row, none for failed ones", async () => {
		const before = await countIngestLagObservations();

		const handleTransactionBatch = createTransactionBatchHandler(
			ingestFailingBatchAndRowB,
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
			"a and c committed; the failed batch attempt and row b add nothing"
		);
	});

	test("rethrows a retryable batch failure so offsets are not committed", async () => {
		const ingest = mock.fn(ingestWithLostConnection);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingest,
			sendToDeadLetterQueue
		);

		await assert.rejects(
			handleTransactionBatch([buildValidMessage("a", 1)]),
			RetryableError,
			"a broken world must replay, not dead-letter"
		);

		assert.equal(
			ingest.mock.callCount(),
			1,
			"no per-message isolation attempted"
		);
		assert.equal(
			sendToDeadLetterQueue.mock.callCount(),
			0,
			"good data must never be dead-lettered"
		);
	});

	test("rethrows a retryable failure raised during isolation", async () => {
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingestFailingBatchThenLosingConnection,
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
		const ingest = mock.fn(ingestAll);
		const sendToDeadLetterQueue = mock.fn(acceptDeadLetters);

		const handleTransactionBatch = createTransactionBatchHandler(
			ingest,
			sendToDeadLetterQueue
		);

		await handleTransactionBatch([
			buildPoisonMessage(1),
			buildTombstoneMessage(2)
		]);

		assert.equal(ingest.mock.callCount(), 0, "nothing to ingest");
		assert.equal(sendToDeadLetterQueue.mock.callCount(), 1);
	});
});
