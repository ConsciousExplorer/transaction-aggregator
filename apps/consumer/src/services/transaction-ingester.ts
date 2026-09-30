import type { Pool } from "pg";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { withTransaction } from "#src/integrations/database/pool.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import type {
	CategorisedTransactionSchema,
	DomainTransactionSchema
} from "#src/schemas/transaction.ts";
import type { Normaliser } from "./domain-normaliser.ts";
import type { RuleCategoriser } from "./rule-categoriser.ts";

export interface BatchOutcome {
	attempted: number;
	inserted: number;
}

/**
 * The write path for a batch: normalise, validate, categorise, insert. Reports
 * what it attempted against what actually landed, since the insert ignores
 * duplicates rather than failing on them.
 */
export interface TransactionIngester {
	ingest(transactions: DomainTransactionSchema[]): Promise<BatchOutcome>;
}

export function createTransactionIngester(
	normaliser: Normaliser,
	categoriser: RuleCategoriser,
	pool: Pool
): TransactionIngester {
	async function ingest(
		transactions: DomainTransactionSchema[]
	): Promise<BatchOutcome> {
		const categorisedTransactions: CategorisedTransactionSchema[] = [];

		for (const transaction of transactions) {
			// The normaliser validates its own output, so this is canonical.
			const normalisedTransaction = normaliser.normalise(transaction);
			const categorisedTransaction = categoriser.categorise(
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
	}

	return { ingest };
}
