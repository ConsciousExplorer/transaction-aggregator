import { RetryableError } from "#src/errors/consumer-errors.ts";
import { fileLogger } from "#src/log.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type {
	BatchOutcome,
	IngestTransactions
} from "#src/services/ingestion.ts";

const logger = fileLogger(import.meta.url);

interface MessageOrigin {
	topic: string;
	partition: number;
	offset: bigint;
}

export type ClassifiedMessage =
	| (MessageOrigin & { kind: "valid"; value: DomainTransactionSchema })
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
	ingestTransactions: IngestTransactions,
	sendToDlq: SendToDlq
): BatchHandler {
	return async function transactionBatchHandler(messages) {
		const validMessages: ValidMessage[] = [];
		const poisonFailures: DlqFailure[] = [];
		let tombstones = 0;

		for (const message of messages) {
			if (message.kind === "valid") validMessages.push(message);
			// Already unreadable upstream — straight to the DLQ, never ingestion.
			if (message.kind === "poison")
				poisonFailures.push({ message, error: message.error });
			if (message.kind === "tombstone") tombstones += 1;
		}

		if (tombstones > 0) {
			logger.debug({ tombstones }, "Tombstones in batch — no-op by design");
		}

		let outcome: BatchOutcome = { attempted: 0, inserted: 0 };

		if (validMessages.length > 0) {
			try {
				outcome = await ingestTransactions(valuesOf(validMessages));
			} catch (error) {
				// "The world is broken": rethrow uncommitted so the whole batch
				// replays from the source topic. Never DLQ good data.
				if (error instanceof RetryableError) throw error;

				logger.warn(
					{ err: error, size: validMessages.length },
					"Batch ingest failed — isolating messages one by one"
				);
				outcome = await ingestOneByOne(
					validMessages,
					ingestTransactions,
					sendToDlq
				);
			}
		}

		const duplicates = outcome.attempted - outcome.inserted;
		if (duplicates > 0) {
			logger.warn({ ...outcome, duplicates }, "There were some duplicates");
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

function valuesOf(validMessages: ValidMessage[]): DomainTransactionSchema[] {
	const values: DomainTransactionSchema[] = [];
	for (const message of validMessages) {
		values.push(message.value);
	}
	return values;
}

/**
 * Fallback after a batch insert fails for a non-retryable reason: one bad row
 * should cost only itself, not the rest of the batch. Each message gets its own
 * insert, and the ones that still fail are dead-lettered individually.
 */
async function ingestOneByOne(
	validMessages: ValidMessage[],
	ingestTransactions: IngestTransactions,
	sendToDlq: SendToDlq
): Promise<BatchOutcome> {
	const outcome: BatchOutcome = { attempted: 0, inserted: 0 };

	for (const message of validMessages) {
		try {
			const single = await ingestTransactions([message.value]);
			outcome.attempted += single.attempted;
			outcome.inserted += single.inserted;
		} catch (error) {
			if (error instanceof RetryableError) throw error;
			await sendToDlq([{ message, error }]);
		}
	}

	return outcome;
}
