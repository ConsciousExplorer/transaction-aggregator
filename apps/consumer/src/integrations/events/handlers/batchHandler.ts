// Batch transaction Orchestartor.

import type { Pool } from "pg";
import { normaliseCard } from "#src/domain/normaliser/card.ts";
import { batchInsertTransactions } from "#src/integrations/database/respository/transaction-repository.ts";
import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

// biome-ignore lint/suspicious/noExplicitAny: TODO: still need to implement the type at boundary
export async function transactionBatchHandler(pool: Pool, messages: any[]) {
	// Main handler logic
	const cardMessages = [];
	for (const message of messages) {
		if (message.topic === "transactions.card") {
			cardMessages.push(normaliseCard(message.value));
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
