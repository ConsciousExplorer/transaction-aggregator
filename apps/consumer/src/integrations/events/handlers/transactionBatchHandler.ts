import { trace } from "@opentelemetry/api";
import { RetryableError } from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type { BatchOutcome } from "#src/services/transaction-ingester.ts";
import {
	ingestLagSeconds,
	tombstonesSkippedTotal
} from "#src/telemetry/metrics.ts";

const logger = createFileLogger(import.meta.url);

/** Where the record came from, as a redrive needs it to produce it again. */
interface MessageOrigin {
	topic: string;
	partition: number;
	offset: bigint;
	// The producer's partition key, the customer id. A record sent without a
	// key has none.
	key: string | undefined;
	// When the record was produced, in milliseconds since the epoch
	recordTimestamp: number;
	headers: Map<string, string>;
}

export type ClassifiedMessage =
	| (MessageOrigin & {
			kind: "valid";
			value: DomainTransactionSchema;
			raw: Buffer;
	  })
	| (MessageOrigin & { kind: "tombstone" })
	| (MessageOrigin & { kind: "poison"; raw: Buffer | null; error: unknown });

export type ValidMessage = Extract<ClassifiedMessage, { kind: "valid" }>;

export interface DeadLetterFailure {
	message: Exclude<ClassifiedMessage, { kind: "tombstone" }>;
	error: unknown;
}

export type BatchHandler = (messages: ClassifiedMessage[]) => Promise<void>;
export type IngestTransactions = (
	transactions: DomainTransactionSchema[]
) => Promise<BatchOutcome>;
export type SendToDeadLetterQueue = (
	failures: DeadLetterFailure[]
) => Promise<void>;

/**
 * Resolves every message in a batch: valid ones are ingested, poison ones are
 * dead-lettered, tombstones are skipped. Ingesting and dead-lettering come in
 * as functions, so the policy here is tested without Kafka or Postgres.
 */
export function createTransactionBatchHandler(
	ingestTransactions: IngestTransactions,
	sendToDeadLetterQueue: SendToDeadLetterQueue
) {
	return async function handleTransactionBatch(messages: ClassifiedMessage[]) {
		const validMessages: ValidMessage[] = [];
		const transactions: DomainTransactionSchema[] = [];
		const poisonFailures: DeadLetterFailure[] = [];
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
					message satisfies never; // a new kind fails to compile here instead of being committed unhandled
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
				await ingestTransactions(transactions);
				observeIngestLag(validMessages);
			} catch (error) {
				// "The world is broken": rethrow uncommitted so the whole batch
				// replays from the source topic. Never DLQ good data.
				if (error instanceof RetryableError) throw error;

				logger.warn(
					{ err: error, size: validMessages.length },
					"Batch ingest failed — isolating messages one by one"
				);
				await ingestOneByOne(
					validMessages,
					ingestTransactions,
					sendToDeadLetterQueue
				);
			}
		}

		if (poisonFailures.length > 0) {
			await sendToDeadLetterQueue(poisonFailures);
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
	ingestTransactions: IngestTransactions,
	sendToDeadLetterQueue: SendToDeadLetterQueue
) {
	for (const message of validMessages) {
		try {
			await ingestTransactions([message.value]);
			observeIngestLag([message]);
		} catch (error) {
			if (error instanceof RetryableError) throw error;
			await sendToDeadLetterQueue([{ message, error }]);
		}
	}
}

function observeIngestLag(messages: ValidMessage[]) {
	const now = Date.now();

	for (const message of messages) {
		ingestLagSeconds.observe((now - message.recordTimestamp) / 1000);
	}
}
