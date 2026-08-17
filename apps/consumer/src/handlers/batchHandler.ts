// Batch transaction Orchestartor.

import type { Pool } from "pg";
import type { RuleRow } from "#src/domain/categorisation/categoriser.ts";
import { normaliseCard } from "#src/domain/normaliser/card.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import { fileLogger } from "#src/runtime.ts";

const logger = fileLogger(import.meta.url);

export async function transactionBatchHandler(
	pool: Pool,
	// biome-ignore lint/suspicious/noExplicitAny: TODO: still need to implement the type at boundary
	messages: any[],
	rules: RuleRow[]
) {
	// Main handler logic
	const cardMessages = [];
	for (const message of messages) {
		if (message.topic === "transactions.card") {
			cardMessages.push(normaliseCard(message.value));
		}
	}

	// testing stuff - needs to move tp the actual place
	try {
	} catch (err) {
		console.log(err);
	}

	try {
		console.log(cardMessages);
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
