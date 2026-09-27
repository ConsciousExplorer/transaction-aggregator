import type { Pool } from "pg";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { withTransaction } from "#src/integrations/database/pool.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import type {
	CategorisedTransactionSchema,
	ExternalTransactionSchema
} from "#src/schemas/transaction.ts";
import type { Normaliser } from "./domain-normaliser.ts";
import type { RuleCategoriser } from "./rule-categoriser.ts";

export interface BatchOutcome {
	attempted: number;
	inserted: number;
}

export type IngestTransactions = (
	transactions: ExternalTransactionSchema[]
) => Promise<BatchOutcome>;

export function createTransactionIngestion(
	normaliser: Normaliser,
	categorizer: RuleCategoriser,
	pool: Pool
): IngestTransactions {
	return async function ingestTransactions(transactions) {
		const categorisedTransactions: CategorisedTransactionSchema[] = [];

		for (const transaction of transactions) {
			const normalisedTransaction = normaliser.normalise(transaction);
			const categorisedTransaction = categorizer.categorise(
				normalisedTransaction
			);
			categorisedTransactions.push({
				...normalisedTransaction,
				...categorisedTransaction
			});
		}

		// Insert batch rows
		try {
			return await withTransaction(pool, async (client) => {
				return await batchInsertTransactions(client, categorisedTransactions);
			});
		} catch (error) {
			throw classifyPostgresError(error, "Batch insert failed");
		}
	};
}
