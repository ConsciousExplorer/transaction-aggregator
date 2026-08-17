// Batch transaction Orchestartor.

import type { Pool } from "pg";
import type { RuleCategorizer } from "#src/domain/categorisation/rule-categorizer.ts";
import { normaliseCard } from "#src/domain/normaliser/card.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

export async function transactionBatchHandler(
	pool: Pool,
	// biome-ignore lint/suspicious/noExplicitAny: TODO: still need to implement the type at boundary
	messages: any[],
	ruleCategorizer: RuleCategorizer
) {
	// Main handler logic
	const cardMessages = [];
	for (const message of messages) {
		if (message.topic === "transactions.card") {
			const cardTransaction = normaliseCard(message.value);
			cardMessages.push(cardTransaction);

			console.log({
				...cardTransaction,
				...ruleCategorizer.categorize(cardTransaction)
			});
		}
	}

	try {
		const result = await batchInsertTransactions(pool, cardMessages);
		const duplicates = result.attempted - result.inserted;
		if (duplicates > 0) {
			logger.warn(
				{ attempted: result.attempted, inserted: result.inserted, duplicates },
				"There were some duplicates"
			);
		}
	} catch (error) {
		logger.error(error, "Some error occured here"); // TODO: update error
	}
}
