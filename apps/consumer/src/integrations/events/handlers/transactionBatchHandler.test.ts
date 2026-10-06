/** biome-ignore-all lint/style/noNonNullAssertion: tests can be null */
import assert from "node:assert";
import { suite, test } from "node:test";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type { BatchOutcome } from "#src/services/transaction-ingester.ts";
import { ingestLagSeconds } from "#src/telemetry/metrics.ts";
import {
	type ClassifiedMessage,
	createTransactionBatchHandler,
	type DlqFailure,
	type ValidMessage
} from "./transactionBatchHandler.ts";

function buildValidMessage(
	externalId: string,
	offset: number
): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		headers: new Map(),
		kind: "valid",
		// Only `sourceType` and identity matter here — ingestion is faked.
		value: {
			sourceType: "card",
			transactionId: externalId
		} as unknown as DomainTransactionSchema,
		raw: Buffer.from(`avro bytes ${externalId}`),
		recordTimestamp: Date.now()
	};
}

/** The histogram is a process-wide singleton, so tests compare before/after. */
async function countIngestLagObservations(): Promise<number> {
	const metric = await ingestLagSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "ingest_lag_seconds_count") return value.value;
	}
	return 0;
}

function buildPoisonMessage(offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
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
		headers: new Map(),
		kind: "tombstone"
	};
}

/** Records every call so a test can assert on batch sizes and retry shape. */
function createRecordingIngestion(
	respond: (transactions: DomainTransactionSchema[]) => BatchOutcome
) {
	const calls: DomainTransactionSchema[][] = [];

	return {
		calls,
		ingest: async (transactions: DomainTransactionSchema[]) => {
			calls.push(transactions);
			return respond(transactions);
		}
	};
}

function createRecordingDlq() {
	const sent: DlqFailure[][] = [];
	return {
		sent,
		sendToDlq: async (failures: DlqFailure[]) => {
			sent.push(failures);
		}
	};
}

const getExternalId = (transaction: DomainTransactionSchema) =>
	(transaction as unknown as { transactionId: string }).transactionId;

suite("transaction batch handler", () => {
	test("ingests the whole batch in one call when nothing fails", async () => {
		const ingestion = createRecordingIngestion((transactions) => ({
			attempted: transactions.length,
			inserted: transactions.length
		}));
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await handle([buildValidMessage("a", 1), buildValidMessage("b", 2)]);

		assert.equal(
			ingestion.calls.length,
			1,
			"one batch insert, not per-message"
		);
		assert.equal(ingestion.calls[0]?.length, 2);
		assert.deepEqual(dlq.sent, []);
	});

	test("dead-letters poison without sending it to ingestion", async () => {
		const ingestion = createRecordingIngestion((transactions) => ({
			attempted: transactions.length,
			inserted: transactions.length
		}));
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await handle([
			buildValidMessage("a", 1),
			buildPoisonMessage(2),
			buildTombstoneMessage(3)
		]);

		assert.equal(ingestion.calls.length, 1);
		assert.equal(ingestion.calls[0]?.length, 1, "only the valid message");
		assert.equal(dlq.sent.length, 1);
		assert.equal(dlq.sent[0]?.length, 1);
	});

	test("isolates one poison row instead of losing the batch", async () => {
		// The batch insert fails; per-message retries succeed except for "b".
		const ingestion = createRecordingIngestion((transactions) => {
			const isRetry = transactions.length === 1;
			if (!isRetry) throw new NonRetryableError("batch violates a constraint");
			if (getExternalId(transactions[0]!) === "b") {
				throw new NonRetryableError("row b violates a constraint");
			}
			return { attempted: 1, inserted: 1 };
		});
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await handle([
			buildValidMessage("a", 1),
			buildValidMessage("b", 2),
			buildValidMessage("c", 3)
		]);

		// 1 failed batch attempt + 3 single-message retries
		assert.equal(ingestion.calls.length, 4);
		assert.equal(dlq.sent.length, 1, "only the offending row is dead-lettered");
		const dlqMessage = dlq.sent[0]![0]!.message;
		assert.equal(dlqMessage.kind, "valid");
		assert.equal(
			getExternalId((dlqMessage as ValidMessage).value),
			"b",
			"the dead-lettered row is the one that failed, not a bystander"
		);
	});

	test("observes ingest lag once per committed row, none for failed ones", async () => {
		// The batch insert fails; per-message retries succeed except for "b".
		const ingestion = createRecordingIngestion((transactions) => {
			if (transactions.length > 1) throw new NonRetryableError("bad batch");
			if (getExternalId(transactions[0]!) === "b") {
				throw new NonRetryableError("row b violates a constraint");
			}
			return { attempted: 1, inserted: 1 };
		});
		const handle = createTransactionBatchHandler(
			ingestion,
			createRecordingDlq().sendToDlq
		);
		const before = await countIngestLagObservations();

		await handle([
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
		const ingestion = createRecordingIngestion(() => {
			throw new RetryableError("connection died");
		});
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await assert.rejects(
			() => handle([buildValidMessage("a", 1)]),
			RetryableError,
			"a broken world must replay, not dead-letter"
		);

		assert.equal(
			ingestion.calls.length,
			1,
			"no per-message isolation attempted"
		);
		assert.deepEqual(dlq.sent, [], "good data must never be dead-lettered");
	});

	test("rethrows a retryable failure raised during isolation", async () => {
		const ingestion = createRecordingIngestion((transactions) => {
			if (transactions.length > 1) throw new NonRetryableError("bad batch");
			throw new RetryableError("connection died mid-isolation");
		});
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await assert.rejects(
			() => handle([buildValidMessage("a", 1), buildValidMessage("b", 2)]),
			RetryableError
		);

		assert.deepEqual(dlq.sent, []);
	});

	test("still dead-letters poison when there is no valid data", async () => {
		const ingestion = createRecordingIngestion(() => ({
			attempted: 0,
			inserted: 0
		}));
		const dlq = createRecordingDlq();
		const handle = createTransactionBatchHandler(ingestion, dlq.sendToDlq);

		await handle([buildPoisonMessage(1), buildTombstoneMessage(2)]);

		assert.equal(ingestion.calls.length, 0, "nothing to ingest");
		assert.equal(dlq.sent.length, 1);
	});
});
