// Batch transaction Orchestartor.

import type { Pool } from "pg";
import type z from "zod";
import type { RuleCategorizer } from "#src/domain/categorisation/rule-categorizer.ts";
import type { Normaliser } from "#src/domain/normaliser/normaliser.ts";
import {
	canonicalTransactionSchema,
	type categorizedTransactionSchema
} from "#src/domain/transaction.ts";
import {
	NonRetryableError,
	RetryableError
} from "#src/errors/consumer-errors.ts";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { withTransaction } from "#src/integrations/database/pool.ts";
import {
	ProgressReport,
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
	ruleCategorizer: RuleCategorizer
) {
	if (messages.length === 0) return;

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

	const transactionBatch: z.infer<typeof categorizedTransactionSchema>[] = [];

	try {
		for (const message of validMessages) {
			const transaction = transactionNormaliser(message.value);
			const validatedTransaction =
				canonicalTransactionSchema.parse(transaction);
			const categorizedTransaction = {
				...validatedTransaction,
				...ruleCategorizer.categorize(validatedTransaction)
			};
			transactionBatch.push(categorizedTransaction);
		}
		// Normalise message
		const insertResult = await withTransaction(pool, async (client) => {
			const result = await batchInsertTransactions(client, transactionBatch);
			// await updateProgressReport(client, progressReport);
			return result;
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
		console.log(error);

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
				"We encountered a retyrable error, a consumer restart will fix"
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
		console.log("Hanlded Batch");
	}
}
