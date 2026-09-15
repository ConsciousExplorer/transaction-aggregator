// Batch transaction Orchestrator.

import type { Pool } from "pg";
import type z from "zod";
import type { RuleCategoriser } from "#src/domain/categorisation/rule-categoriser.ts";
import type { Normaliser } from "#src/domain/normaliser/normaliser.ts";
import {
	canonicalTransactionSchema,
	type categorisedTransactionSchema
} from "#src/domain/transaction.ts";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { withTransaction } from "#src/integrations/database/pool.ts";
import {
	type ProgressReport,
	updateProgressReport
} from "#src/integrations/database/repositories/progress-repository.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import {
	type ConsumedMessage,
	type ConsumedTransaction,
	commitBatch,
	type DlqProducer,
	hasDeserialisationFailure,
	sendToDLQ
} from "#src/integrations/events/kafka.ts";
import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

export async function transactionBatchHandler(
	pool: Pool,
	messages: ConsumedMessage[],
	dlqProducer: DlqProducer,
	dlqTopic: string,
	transactionNormaliser: Normaliser,
	RuleCategoriser: RuleCategoriser
) {
	const [firstMessage] = messages;
	if (!firstMessage) return;

	const tombstoneMessage = messages.filter(
		(message) => !hasDeserialisationFailure(message) && message.value == null
	);
	const poisonMessages = messages.filter((message) =>
		hasDeserialisationFailure(message)
	);
	const validMessages = messages.filter(
		(message): message is ConsumedMessage & { value: ConsumedTransaction } =>
			!hasDeserialisationFailure(message) && message.value != null
	);

	// Rows stay grouped by partition: ingest_progress is keyed on
	// (topic, partition), so inserted/duplicate counts are only attributable
	// when each partition's rows are inserted separately.
	const rowsByPartition = new Map<
		number,
		z.infer<typeof categorisedTransactionSchema>[]
	>();

	try {
		for (const message of validMessages) {
			const transaction = transactionNormaliser(message.value);
			const validatedTransaction =
				canonicalTransactionSchema.parse(transaction);
			const categorisedTransaction = {
				...validatedTransaction,
				...RuleCategoriser.categorise(validatedTransaction)
			};

			const rows = rowsByPartition.get(message.partition) ?? [];
			rows.push(categorisedTransaction);
			rowsByPartition.set(message.partition, rows);
		}

		const insertResult = await withTransaction(pool, async (client) => {
			const totals = { attempted: 0, inserted: 0 };

			// Every partition seen in the batch gets a progress row — including
			// ones carrying only tombstones or poison, whose offsets still move.
			for (const partition of new Set(messages.map((m) => m.partition))) {
				const rows = rowsByPartition.get(partition) ?? [];
				const result = await batchInsertTransactions(client, rows);
				totals.attempted += result.attempted;
				totals.inserted += result.inserted;

				await updateProgressReport(
					client,
					buildProgressReport(firstMessage.topic, partition, rows, result, {
						messages,
						tombstones: tombstoneMessage,
						poison: poisonMessages
					})
				);
			}

			return totals;
		});

		const duplicates = insertResult.attempted - insertResult.inserted;
		if (duplicates > 0) {
			logger.warn(
				{
					attempted: insertResult.attempted,
					inserted: insertResult.inserted,
					duplicates
				},
				"There were some duplicates"
			);
		}
		// const progressReport = await updateProgress(pool);
	} catch (error) {
		// Classify errors
		const failure = classifyPostgresError(error, "Batch insert failed");

		// TODO: Check
		if (failure instanceof NonRetryableError) {
			logger.error(
				{ error },
				"A non retryable error was encountered, not halting"
			);
			await sendToDLQ(dlqProducer, dlqTopic, [
				...tombstoneMessage,
				...poisonMessages
			]);
		}

		if (failure instanceof RetryableError) {
			logger.error(
				"We encountered a retryable error, a consumer restart will fix"
			);

			throw error;
		}

		// Rethrow rather than swallow. Falling through to the commit below
		// would advance offsets past rows that were never inserted — the
		// batch replays on the next run instead.
		logger.error(
			{
				error,
				size: messages.length,
				valid: validMessages.length,
				poison: [...tombstoneMessage, ...poisonMessages].length
			},
			"Batch failed — not committing"
		);
	}

	if ([...tombstoneMessage, ...poisonMessages].length > 0) {
		logger.warn(
			{ size: [...tombstoneMessage, ...poisonMessages].length, dlqTopic },
			"Dead-lettered undeserialisable messages"
		);
	}

	try {
		// Commit only once the batch is durably handled — including the
		// poison records, which are now safely on the DLQ topic.
		await commitBatch(messages);
	} catch (error) {
		logger.warn(
			{ err: error, size: messages.length },
			"Commit failed after a successful insert — offsets will replay"
		);
	} finally {
		logger.debug("Handled Batch");
	}
}

function buildProgressReport(
	topic: string,
	partition: number,
	rows: z.infer<typeof categorisedTransactionSchema>[],
	insert: { attempted: number; inserted: number },
	batch: {
		messages: ConsumedMessage[];
		tombstones: ConsumedMessage[];
		poison: ConsumedMessage[];
	}
): ProgressReport {
	const inPartition = (message: ConsumedMessage) =>
		message.partition === partition;
	const partitionMessages = batch.messages.filter(inPartition);

	// Offsets advance for every message, not only inserted rows.
	let lastOffset = -1n;
	for (const message of partitionMessages) {
		if (message.offset > lastOffset) lastOffset = message.offset;
	}

	// ISO strings order lexicographically, so max() needs no Date parsing.
	let lastOccurredAt: string | null = null;
	for (const row of rows) {
		if (!lastOccurredAt || row.occurredAt > lastOccurredAt) {
			lastOccurredAt = row.occurredAt;
		}
	}

	return {
		topic,
		partition,
		lastOffset: Number(lastOffset),
		counts: {
			messagesTotal: partitionMessages.length,
			rowsInsertedTotal: insert.inserted,
			duplicatesTotal: insert.attempted - insert.inserted,
			dlqTotal: batch.poison.filter(inPartition).length,
			tombstonesTotal: batch.tombstones.filter(inPartition).length,
			// No status gate yet — nothing is filtered before normalisation.
			filteredTotal: 0,
			lastOccurredAt
		}
	};
}
