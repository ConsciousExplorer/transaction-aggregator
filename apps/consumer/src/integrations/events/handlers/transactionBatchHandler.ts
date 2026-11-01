import { trace } from "@opentelemetry/api";
import type { Pool } from "pg";
import {
	type CompiledRules,
	compileRules,
	type RuleSet
} from "#src/domain/rule-categoriser.ts";
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
 * A row with the message it came from, so a row Postgres refuses is
 * dead-lettered as its message.
 */
interface PreparedMessage {
	message: ValidMessage;
	row: PreparedTransaction;
}

/** A batch sorted by what happens to each message. */
interface PreparedBatch {
	preparedMessages: PreparedMessage[];
	deadLetters: DeadLetterFailure[];
	tombstones: number;
}

export type BatchHandler = (messages: ClassifiedMessage[]) => Promise<void>;
export type SendToDeadLetterQueue = (
	failures: DeadLetterFailure[]
) => Promise<void>;

/**
 * The policy for one batch: insert every row in one statement, isolate the
 * batch row by row when Postgres refuses it, dead-letter what can't be stored,
 * and rethrow an outage so the batch is read again. The rules are compiled
 * once, here, so each record only looks them up. The dead-letter sender comes
 * in as a function, so the policy is tested with a fake pool and no Kafka.
 */
export function createTransactionBatchHandler(
	transactionType: TransactionType,
	ruleset: RuleSet,
	pool: Pool,
	sendToDeadLetterQueue: SendToDeadLetterQueue
) {
	const rules = compileRules(ruleset);

	return async function handleTransactionBatch(messages: ClassifiedMessage[]) {
		const batch = prepareBatch(messages, transactionType, rules);

		// Outcome counts on the batch span (no-op when tracing is off)
		trace.getActiveSpan()?.setAttributes({
			"batch.valid": batch.preparedMessages.length,
			"batch.poison": batch.deadLetters.length,
			"batch.tombstones": batch.tombstones
		});

		if (batch.tombstones > 0) {
			tombstonesSkippedTotal.inc(batch.tombstones);
			logger.debug(
				{ tombstones: batch.tombstones },
				"Tombstones in batch — no-op by design"
			);
		}

		if (batch.preparedMessages.length > 0) {
			const rows = collectRows(batch.preparedMessages);
			try {
				await insertTransactions(rows, pool);
				observeIngestLag(batch.preparedMessages);
			} catch (error) {
				// "The world is broken": rethrow uncommitted so the whole batch
				// replays from the source topic. Never DLQ good data.
				if (error instanceof RetryableError) throw error;

				logger.warn(
					{ err: error, size: rows.length },
					"Batch insert failed — isolating rows one by one"
				);
				await insertOneByOne(
					batch.preparedMessages,
					pool,
					sendToDeadLetterQueue
				);
			}
		}

		if (batch.deadLetters.length > 0) {
			await sendToDeadLetterQueue(batch.deadLetters);
			logger.warn(
				{ size: batch.deadLetters.length },
				"Dead-lettered messages that can't be stored"
			);
		}
	};
}

/**
 * Sorts the batch by what happens to each message. A valid record is prepared
 * here, so one that can't become a row is known before any SQL runs: it is
 * dead-lettered alone and the rest of the batch still goes in one statement.
 */
function prepareBatch(
	messages: ClassifiedMessage[],
	transactionType: TransactionType,
	rules: CompiledRules
) {
	const batch: PreparedBatch = {
		preparedMessages: [],
		deadLetters: [],
		tombstones: 0
	};

	for (const message of messages) {
		switch (message.kind) {
			case "valid":
				try {
					const row = prepareTransaction(message.value, transactionType, rules);
					batch.preparedMessages.push({ message, row });
				} catch (error) {
					batch.deadLetters.push({ message, error });
				}
				break;
			case "poison":
				batch.deadLetters.push({ message, error: message.error });
				break;
			case "tombstone":
				batch.tombstones += 1;
				break;
			default:
				message satisfies never; // a new kind fails to compile here instead of being committed unhandled
		}
	}

	return batch;
}

/** The rows alone, as the one INSERT statement takes them. */
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
 * insert, and the ones Postgres still refuses are dead-lettered as their
 * message.
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
		const lagSeconds = (now - preparedMessage.message.recordTimestamp) / 1000;
		ingestLagSeconds.observe(lagSeconds);
	}
}
