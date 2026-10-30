import { trace } from "@opentelemetry/api";
import type { Pool } from "pg";
import { compileRules, type RuleSet } from "#src/domain/rule-categoriser.ts";
import { RetryableError } from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";
import type {
	DomainTransactionSchema,
	TransactionType
} from "#src/schemas/transaction.ts";
import {
	insertTransactions,
	type PreparedTransaction,
	prepareTransaction
} from "#src/services/transaction-ingester.ts";
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
	key: string | undefined;
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

/**
 * A valid message with its row, kept together so a row the insert refuses is
 * dead-lettered as the message it came from.
 */
interface PreparedMessage {
	message: ValidMessage;
	row: PreparedTransaction;
}

export type BatchHandler = (messages: ClassifiedMessage[]) => Promise<void>;
export type SendToDeadLetterQueue = (
	failures: DeadLetterFailure[]
) => Promise<void>;

/**
 * Resolves every message in a batch: valid ones are prepared and inserted,
 * ones that can't be stored are dead-lettered, tombstones are skipped. The
 * rules are compiled once, here, so each record only looks them up. The
 * dead-letter sender comes in as a function, so the policy here is tested
 * with a fake pool and no Kafka.
 */
export function createTransactionBatchHandler(
	transactionType: TransactionType,
	ruleset: RuleSet,
	pool: Pool,
	sendToDeadLetterQueue: SendToDeadLetterQueue
) {
	const rules = compileRules(ruleset);

	return async function handleTransactionBatch(messages: ClassifiedMessage[]) {
		const preparedMessages: PreparedMessage[] = [];
		const poisonFailures: DeadLetterFailure[] = [];
		let tombstones = 0;

		for (const message of messages) {
			switch (message.kind) {
				case "valid":
					// A record that can't become a row is known before any SQL
					// runs, so it is dead-lettered alone and the rest of the
					// batch still goes in one statement.
					try {
						preparedMessages.push({
							message,
							row: prepareTransaction(message.value, transactionType, rules)
						});
					} catch (error) {
						poisonFailures.push({ message, error });
					}
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
			"batch.valid": preparedMessages.length,
			"batch.poison": poisonFailures.length,
			"batch.tombstones": tombstones
		});

		if (tombstones > 0) {
			tombstonesSkippedTotal.inc(tombstones);
			logger.debug({ tombstones }, "Tombstones in batch — no-op by design");
		}

		if (preparedMessages.length > 0) {
			try {
				await insertTransactions(collectRows(preparedMessages), pool);
				observeIngestLag(preparedMessages);
			} catch (error) {
				// "The world is broken": rethrow uncommitted so the whole batch
				// replays from the source topic. Never DLQ good data.
				if (error instanceof RetryableError) throw error;

				logger.warn(
					{ err: error, size: preparedMessages.length },
					"Batch insert failed — isolating rows one by one"
				);
				await insertOneByOne(preparedMessages, pool, sendToDeadLetterQueue);
			}
		}

		if (poisonFailures.length > 0) {
			await sendToDeadLetterQueue(poisonFailures);
			logger.warn(
				{ size: poisonFailures.length },
				"Dead-lettered messages that can't be stored"
			);
		}
	};
}

function collectRows(preparedMessages: PreparedMessage[]) {
	const rows: PreparedTransaction[] = [];
	for (const preparedMessage of preparedMessages) {
		rows.push(preparedMessage.row);
	}
	return rows;
}

/**
 * Fallback after the batch insert fails for a non-retryable reason: one bad
 * row should cost only itself, not the rest of the batch. Each row gets its own
 * insert, and the ones that still fail are dead-lettered as their message.
 */
async function insertOneByOne(
	preparedMessages: PreparedMessage[],
	pool: Pool,
	sendToDeadLetterQueue: SendToDeadLetterQueue
) {
	for (const preparedMessage of preparedMessages) {
		try {
			await insertTransactions([preparedMessage.row], pool);
			observeIngestLag([preparedMessage]);
		} catch (error) {
			if (error instanceof RetryableError) throw error;
			await sendToDeadLetterQueue([
				{ message: preparedMessage.message, error }
			]);
		}
	}
}

function observeIngestLag(preparedMessages: PreparedMessage[]) {
	const now = Date.now();

	for (const preparedMessage of preparedMessages) {
		ingestLagSeconds.observe(
			(now - preparedMessage.message.recordTimestamp) / 1000
		);
	}
}
