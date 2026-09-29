import assert from "node:assert";
import { suite, test } from "node:test";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type { BatchOutcome } from "#src/services/ingestion.ts";
import {
	type ClassifiedMessage,
	createTransactionBatchHandler,
	type DlqFailure,
	type ValidMessage
} from "./transactionBatchHandler.ts";

function validMessage(externalId: string, offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		kind: "valid",
		// Only `sourceType` and identity matter here — ingestion is faked.
		value: {
			sourceType: "card",
			transactionId: externalId
		} as unknown as DomainTransactionSchema
	};
}

function poisonMessage(offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		kind: "poison",
		raw: Buffer.from("not avro"),
		error: new Error("bad magic byte")
	};
}

function tombstoneMessage(offset: number): ClassifiedMessage {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		kind: "tombstone"
	};
}

/** Records every call so a test can assert on batch sizes and retry shape. */
function recordingIngestion(
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

function recordingDlq() {
	const sent: DlqFailure[][] = [];
	return {
		sent,
		sendToDlq: async (failures: DlqFailure[]) => {
			sent.push(failures);
		}
	};
}

const externalIdOf = (transaction: DomainTransactionSchema) =>
	(transaction as unknown as { transactionId: string }).transactionId;

suite("transaction batch handler", () => {
	test("ingests the whole batch in one call when nothing fails", async () => {
		const ingestion = recordingIngestion((transactions) => ({
			attempted: transactions.length,
			inserted: transactions.length
		}));
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await handle([validMessage("a", 1), validMessage("b", 2)]);

		assert.equal(
			ingestion.calls.length,
			1,
			"one batch insert, not per-message"
		);
		assert.equal(ingestion.calls[0]?.length, 2);
		assert.deepEqual(dlq.sent, []);
	});

	test("dead-letters poison without sending it to ingestion", async () => {
		const ingestion = recordingIngestion((transactions) => ({
			attempted: transactions.length,
			inserted: transactions.length
		}));
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await handle([validMessage("a", 1), poisonMessage(2), tombstoneMessage(3)]);

		assert.equal(ingestion.calls.length, 1);
		assert.equal(ingestion.calls[0]?.length, 1, "only the valid message");
		assert.equal(dlq.sent.length, 1);
		assert.equal(dlq.sent[0]?.length, 1);
	});

	test("isolates one poison row instead of losing the batch", async () => {
		// The batch insert fails; per-message retries succeed except for "b".
		const ingestion = recordingIngestion((transactions) => {
			const isRetry = transactions.length === 1;
			if (!isRetry) throw new NonRetryableError("batch violates a constraint");
			if (externalIdOf(transactions[0]!) === "b") {
				throw new NonRetryableError("row b violates a constraint");
			}
			return { attempted: 1, inserted: 1 };
		});
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await handle([
			validMessage("a", 1),
			validMessage("b", 2),
			validMessage("c", 3)
		]);

		// 1 failed batch attempt + 3 single-message retries
		assert.equal(ingestion.calls.length, 4);
		assert.equal(dlq.sent.length, 1, "only the offending row is dead-lettered");
		const dlqMessage = dlq.sent[0]![0]!.message;
		assert.equal(dlqMessage.kind, "valid");
		assert.equal(
			externalIdOf((dlqMessage as ValidMessage).value),
			"b",
			"the dead-lettered row is the one that failed, not a bystander"
		);
	});

	test("rethrows a retryable batch failure so offsets are not committed", async () => {
		const ingestion = recordingIngestion(() => {
			throw new RetryableError("connection died");
		});
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await assert.rejects(
			() => handle([validMessage("a", 1)]),
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
		const ingestion = recordingIngestion((transactions) => {
			if (transactions.length > 1) throw new NonRetryableError("bad batch");
			throw new RetryableError("connection died mid-isolation");
		});
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await assert.rejects(
			() => handle([validMessage("a", 1), validMessage("b", 2)]),
			RetryableError
		);

		assert.deepEqual(dlq.sent, []);
	});

	test("still dead-letters poison when there is no valid data", async () => {
		const ingestion = recordingIngestion(() => ({
			attempted: 0,
			inserted: 0
		}));
		const dlq = recordingDlq();
		const handle = createTransactionBatchHandler(
			ingestion.ingest,
			dlq.sendToDlq
		);

		await handle([poisonMessage(1), tombstoneMessage(2)]);

		assert.equal(ingestion.calls.length, 0, "nothing to ingest");
		assert.equal(dlq.sent.length, 1);
	});
});
