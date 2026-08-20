// Batch transaction Orchestartor.

import type { Pool } from "pg";
import type { RuleCategorizer } from "#src/domain/categorisation/rule-categorizer.ts";
import type { Normaliser } from "#src/domain/normaliser/normaliser.ts";
import { canonicalTransactionSchema } from "#src/domain/transaction.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

export async function transactionBatchHandler(
	pool: Pool,
	// biome-ignore lint/suspicious/noExplicitAny: TODO: still need to implement the type at boundary
	messages: any[],
	transactionNormaliser: Normaliser,
	ruleCategorizer: RuleCategorizer
) {
	// Main handler logic
	const transactions = [];
	for (const message of messages) {
		// Tombstones and empty payloads carry no record to normalise.
		if (message.value == null) continue;

		const transaction = transactionNormaliser(message.value);

		const validatedTransaction = canonicalTransactionSchema.parse(transaction);

		const categorizedTransaction = {
			...validatedTransaction,
			...ruleCategorizer.categorize(validatedTransaction)
		};

		transactions.push(categorizedTransaction);
	}

	// Don't catch errors here. If we do, we need to throw them again.
	// Errors should propagate to the kafka layer to hanndle and commit
	const result = await batchInsertTransactions(pool, transactions);

	const duplicates = result.attempted - result.inserted;
	if (duplicates > 0) {
		logger.warn(
			{ attempted: result.attempted, inserted: result.inserted, duplicates },
			"There were some duplicates"
		);
	}
}
