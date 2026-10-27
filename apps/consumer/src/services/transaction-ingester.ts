import type { Pool } from "pg";
import {
	type CompiledRules,
	categoriseTransaction,
	compileRules,
	type RuleSet,
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

export interface BatchOutcome {
	attempted: number;
	inserted: number;
}

/**
 * The write path for a batch: normalise, validate, categorise, insert. Reports
 * what it attempted against what actually landed, since the insert ignores
 * duplicates rather than failing on them. The rules are compiled once, here,
 * so each batch only looks them up.
 */
export function createTransactionIngester(
	transactionType: TransactionType,
	ruleset: RuleSet,
	pool: Pool
) {
	const rules = compileRules(ruleset);

	return async function ingestTransactions(
		transactions: DomainTransactionSchema[]
	) {
		const { categorisedTransactions, matcherTypes } = await runInSpan(
			"categorize",
			{ attributes: { "transaction.count": transactions.length } },
			() => categoriseTransactions(transactions, transactionType, rules)
		);

		const outcome = await insertTransactions(categorisedTransactions, pool);

		recordCommittedBatch(matcherTypes, outcome);

		return outcome;
	};
}

function categoriseTransactions(
	transactions: DomainTransactionSchema[],
	transactionType: TransactionType,
	rules: CompiledRules
) {
	const categorisedTransactions: CategorisedTransactionSchema[] = [];
	const matcherTypes: Verdict["matcherType"][] = [];

	for (const transaction of transactions) {
		// The normaliser validates its own output, so this is canonical.
		const normalisedTransaction = normaliseTransaction(
			transaction,
			transactionType
		);
		const verdict = categoriseTransaction(normalisedTransaction, rules);
		categorisedTransactions.push({ ...normalisedTransaction, ...verdict });
		matcherTypes.push(verdict.matcherType);
	}

	return { categorisedTransactions, matcherTypes };
}

/**
 * One INSERT for the whole batch, atomic on its own. A Postgres failure is
 * classified here, so the batch handler can tell a retryable outage from a
 * row that will never insert.
 */
async function insertTransactions(
	transactions: CategorisedTransactionSchema[],
	pool: Pool
) {
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
				const result = await batchInsertTransactions(pool, transactions);
				span.setAttribute("rows.inserted", result.inserted);
				return result;
			}
		);
	} catch (error) {
		throw classifyPostgresError(error, "Batch insert failed");
	} finally {
		endInsertTimer();
	}
}

/**
 * Records only after the insert committed, so a batch that
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
