import type { Pool } from "pg";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { runInTransaction } from "#src/integrations/database/pool.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import type {
	CategorisedTransactionSchema,
	DomainTransactionSchema
} from "#src/schemas/transaction.ts";
import {
	categorisationVerdictsTotal,
	duplicatesSkippedTotal,
	insertDurationSeconds,
	rowsInsertedTotal
} from "#src/telemetry/metrics.ts";
import { runInSpan } from "#src/telemetry/tracing.ts";
import type { Normaliser } from "./domain-normaliser.ts";
import type { RuleCategoriser, Verdict } from "./rule-categoriser.ts";

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
	function categoriseAll(transactions: DomainTransactionSchema[]) {
		const categorisedTransactions: CategorisedTransactionSchema[] = [];
		const matcherTypes: Verdict["matcherType"][] = [];

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
			matcherTypes.push(categorisedTransaction.matcherType);
		}

		return { categorisedTransactions, matcherTypes };
	}

	async function ingest(
		transactions: DomainTransactionSchema[]
	): Promise<BatchOutcome> {
		const { categorisedTransactions, matcherTypes } = await runInSpan(
			"categorize",
			{ attributes: { "transaction.count": transactions.length } },
			() => categoriseAll(transactions)
		);

		// Insert batch rows
		const endInsertTimer = insertDurationSeconds.startTimer();
		let outcome: BatchOutcome;
		try {
			outcome = await runInSpan(
				"db.insert",
				{
					attributes: {
						"db.system.name": "postgresql",
						"db.operation.name": "INSERT",
						"db.collection.name": "transactions",
						"rows.attempted": categorisedTransactions.length
					}
				},
				async (span) => {
					const result = await runInTransaction(pool, async (client) => {
						return await batchInsertTransactions(
							client,
							categorisedTransactions
						);
					});
					span.setAttribute("rows.inserted", result.inserted);
					return result;
				}
			);
		} catch (error) {
			throw classifyPostgresError(error, "Batch insert failed");
		}
		endInsertTimer();

		recordCommittedBatch(matcherTypes, outcome);

		return outcome;
	}

	return { ingest };
}

/**
 * Records only after the database transaction committed, so a batch that
 * rolls back and is then retried one message at a time is not counted twice.
 */
function recordCommittedBatch(
	matcherTypes: Verdict["matcherType"][],
	outcome: BatchOutcome
) {
	rowsInsertedTotal.inc(outcome.inserted);
	duplicatesSkippedTotal.inc(outcome.attempted - outcome.inserted);

	for (const matcherType of matcherTypes) {
		categorisationVerdictsTotal.inc({ matcher_type: matcherType });
	}
}
