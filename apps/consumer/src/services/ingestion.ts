import type { Pool } from "pg";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { withTransaction } from "#src/integrations/database/pool.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import {
	type CanonicalTransactionSchema,
	type CategorisedTransactionSchema,
	canonicalTransactionSchema,
	type DomainTransactionSchema
} from "#src/schemas/transaction.ts";
import type { Normaliser } from "./domain-normaliser.ts";
import type { RuleCategoriser } from "./rule-categoriser.ts";

export interface BatchOutcome {
	attempted: number;
	inserted: number;
}

export type IngestTransactions = (
	transactions: DomainTransactionSchema[]
) => Promise<BatchOutcome>;

/**
 * A normaliser that emits a shape the canonical schema rejects is a code or
 * mapping defect, not a transient fault — so this raises NonRetryableError and
 * the batch handler dead-letters the offending record instead of replaying it
 * forever against the same bad mapping.
 */
function parseCanonical(
	transaction: CanonicalTransactionSchema
): CanonicalTransactionSchema {
	const result = canonicalTransactionSchema.safeParse(transaction);

	if (!result.success) {
		throw new NonRetryableError("Normalised transaction failed validation", {
			cause: result.error,
			details: {
				transactionType: transaction.transactionType,
				externalId: transaction.externalId,
				issues: result.error.issues.map(
					(issue) => `${issue.path.join(".")}: ${issue.message}`
				)
			}
		});
	}

	return result.data;
}

export function createTransactionIngestion(
	normaliser: Normaliser,
	categorizer: RuleCategoriser,
	pool: Pool
): IngestTransactions {
	return async function ingestTransactions(transactions) {
		const categorisedTransactions: CategorisedTransactionSchema[] = [];

		for (const transaction of transactions) {
			const normalisedTransaction = normaliser.normalise(transaction);

			const validatedTransaction = parseCanonical(normalisedTransaction);

			const categorisedTransaction =
				categorizer.categorise(validatedTransaction);
			categorisedTransactions.push({
				...validatedTransaction,
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
