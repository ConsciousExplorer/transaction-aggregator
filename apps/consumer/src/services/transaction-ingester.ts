import type { Pool } from "pg";
import { classifyPostgresError } from "#src/errors/postgres.ts";
import { runInTransaction } from "#src/integrations/database/pool.ts";
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
import { normaliseTransaction } from "./domain-normaliser.ts";
import {
	type CompiledRules,
	categoriseTransaction,
	compileRules,
	type RuleSet,
	type Verdict
} from "./rule-categoriser.ts";

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
 * One database transaction for the whole batch. A Postgres failure is
 * classified here, so the batch handler can tell a retryable outage from a
 * row that will never insert.
 */
async function insertTransactions(
	transactions: CategorisedTransactionSchema[],
	pool: Pool
) {
	const endInsertTimer = insertDurationSeconds.startTimer();

	try {
		const outcome = await runInSpan(
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
				const result = await runInTransaction(pool, (client) =>
					batchInsertTransactions(client, transactions)
				);
				span.setAttribute("rows.inserted", result.inserted);
				return result;
			}
		);
		endInsertTimer();
		return outcome;
	} catch (error) {
		throw classifyPostgresError(error, "Batch insert failed");
	}
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
