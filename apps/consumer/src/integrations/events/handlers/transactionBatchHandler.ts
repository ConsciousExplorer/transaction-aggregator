import { trace } from "@opentelemetry/api";
import { RetryableError } from "#src/errors/consumer-errors.ts";
import { fileLogger } from "#src/logger.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type { TransactionIngester } from "#src/services/transaction-ingester.ts";
import {
	ingestLagSeconds,
	tombstonesSkippedTotal
} from "#src/telemetry/metrics.ts";
import { assertNever } from "#src/utils/assert-never.ts";

const logger = fileLogger(import.meta.url);

interface MessageOrigin {
	topic: string;
	partition: number;
	offset: bigint;
}

export type ClassifiedMessage =
	| (MessageOrigin & {
			kind: "valid";
			value: DomainTransactionSchema;
			recordTimestamp: number;
	  })
	| (MessageOrigin & { kind: "tombstone" })
	| (MessageOrigin & { kind: "poison"; raw: Buffer | null; error: unknown });

export type ValidMessage = Extract<ClassifiedMessage, { kind: "valid" }>;

export interface DlqFailure {
	message: Exclude<ClassifiedMessage, { kind: "tombstone" }>;
	error: unknown;
}

export type BatchHandler = (messages: ClassifiedMessage[]) => Promise<void>;
export type SendToDlq = (failures: DlqFailure[]) => Promise<void>;

export function createTransactionBatchHandler(
	ingester: TransactionIngester,
	sendToDlq: SendToDlq
): BatchHandler {
	return async function transactionBatchHandler(messages) {
		const validMessages: ValidMessage[] = [];
		const transactions: DomainTransactionSchema[] = [];
		const poisonFailures: DlqFailure[] = [];
		let tombstones = 0;

		for (const message of messages) {
			// Both: the batch insert takes the values, while the one-by-one
			// fallback needs the whole message to dead-letter the row that failed.
			switch (message.kind) {
				case "valid":
					validMessages.push(message);
					transactions.push(message.value);
					break;
				case "poison":
					poisonFailures.push({ message, error: message.error });
					break;
				case "tombstone":
					tombstones += 1;
					break;
				default:
					assertNever(message); // new kind ⇒ compile error, not a silent commit
			}
		}

		// Outcome counts on the batch span (no-op when tracing is off)
		trace.getActiveSpan()?.setAttributes({
			"batch.valid": validMessages.length,
			"batch.poison": poisonFailures.length,
			"batch.tombstones": tombstones
		});

		if (tombstones > 0) {
			tombstonesSkippedTotal.inc(tombstones);
			logger.debug({ tombstones }, "Tombstones in batch — no-op by design");
		}

		if (validMessages.length > 0) {
			try {
				await ingester.ingest(transactions);
				observeIngestLag(validMessages);
			} catch (error) {
				// "The world is broken": rethrow uncommitted so the whole batch
				// replays from the source topic. Never DLQ good data.
				if (error instanceof RetryableError) throw error;

				logger.warn(
					{ err: error, size: validMessages.length },
					"Batch ingest failed — isolating messages one by one"
				);
				await ingestOneByOne(validMessages, ingester, sendToDlq);
			}
		}

		if (poisonFailures.length > 0) {
			await sendToDlq(poisonFailures);
			logger.warn(
				{ size: poisonFailures.length },
				"Dead-lettered undeserialisable messages"
			);
		}

		// Returning normally asserts every message is durably resolved —
		// the adapter commits on it, and only on it.
	};
}

/**
 * Fallback after a batch insert fails for a non-retryable reason: one bad row
 * should cost only itself, not the rest of the batch. Each message gets its own
 * insert, and the ones that still fail are dead-lettered individually.
 */
async function ingestOneByOne(
	validMessages: ValidMessage[],
	ingester: TransactionIngester,
	sendToDlq: SendToDlq
): Promise<void> {
	for (const message of validMessages) {
		try {
			await ingester.ingest([message.value]);
			observeIngestLag([message]);
		} catch (error) {
			if (error instanceof RetryableError) throw error;
			await sendToDlq([{ message, error }]);
		}
	}
}

function observeIngestLag(messages: ValidMessage[]) {
	const now = Date.now();

	for (const message of messages) {
		ingestLagSeconds.observe((now - message.recordTimestamp) / 1000);
	}
}
