import type { Pool } from "pg";
import {
	type CompiledRules,
	categoriseTransaction,
	type Verdict
} from "#src/domain/rule-categoriser.ts";
import { normaliseTransaction } from "#src/domain/transaction-normaliser.ts";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { batchInsertTransactions } from "#src/integrations/database/repositories/transaction-repository.ts";
import type {
	CategorisedTransactionSchema,
	DomainTransactionSchema,
	TransactionType
} from "#src/schemas/transaction.ts";
import {
	categorisationVerdictsTotal,
	duplicatesSkippedTotal,
	insertDurationSeconds,
	rowsInsertedTotal
} from "#src/telemetry/metrics.ts";
import { runInSpan } from "#src/telemetry/tracing.ts";

/** A row ready to insert, with the matcher that chose its category kept for the metrics. */
export type PreparedTransaction = CategorisedTransactionSchema &
	Pick<Verdict, "matcherType">;

/**
 * The per-record step of the write path: normalise, validate, categorise. It
 * throws for a record that can't become a row, so the batch handler can
 * dead-letter that record alone before anything reaches the database.
 */
export function prepareTransaction(
	transaction: DomainTransactionSchema,
	transactionType: TransactionType,
	rules: CompiledRules
) {
	// The normaliser validates its own output, so this is canonical.
	const normalisedTransaction = normaliseTransaction(
		transaction,
		transactionType
	);
	const verdict = categoriseTransaction(normalisedTransaction, rules);
	return { ...normalisedTransaction, ...verdict };
}

/**
 * The per-batch step: one INSERT for all the rows, atomic on its own. Returns
 * how many rows landed, since the insert skips duplicates rather than failing
 * on them.
 */
export async function insertTransactions(
	transactions: PreparedTransaction[],
	pool: Pool
) {
	const inserted = await insertBatch(transactions, pool);
	recordCommittedBatch(transactions, inserted);
	return inserted;
}

/**
 * A Postgres failure is classified here, so the batch handler can tell a
 * retryable outage from a row that will never insert.
 */
async function insertBatch(transactions: PreparedTransaction[], pool: Pool) {
	// Timed whether it succeeds or not, so a slow failure shows up too
	const endInsertTimer = insertDurationSeconds.startTimer();

	try {
		return await runInSpan(
			"db.insert",
			{
				attributes: {
					"db.system.name": "postgresql",
					"db.operation.name": "INSERT",
					"db.collection.name": "txn_agg.transactions",
					"rows.attempted": transactions.length
				}
			},
			async (span) => {
				const inserted = await batchInsertTransactions(pool, transactions);
				span.setAttribute("rows.inserted", inserted);
				return inserted;
			}
		);
	} catch (error) {
		throw classifyPostgresError(error, "Batch insert failed");
	} finally {
		endInsertTimer();
	}
}

/**
 * Records only after the insert committed, so a batch that fails and is then
 * retried one row at a time is not counted twice.
 */
function recordCommittedBatch(
	transactions: PreparedTransaction[],
	inserted: number
) {
	rowsInsertedTotal.inc(inserted);
	duplicatesSkippedTotal.inc(transactions.length - inserted);

	for (const transaction of transactions) {
		categorisationVerdictsTotal.inc({ matcher_type: transaction.matcherType });
	}
}
