import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type { Pool } from "pg";
import { RetryableError } from "#src/errors/consumer-errors.ts";
import { createDatabase } from "#src/integrations/database/pool.ts";
import { loadRuleset } from "#src/integrations/database/repositories/rule-repository.ts";
import {
	type BatchHandler,
	createTransactionBatchHandler,
	type DeadLetterFailure
} from "#src/integrations/events/handlers/transactionBatchHandler.ts";
import { buildCardRecord } from "#src/services/test-records.ts";
import { createTransactionIngester } from "#src/services/transaction-ingester.ts";
import {
	closeTestDatabasePools,
	startTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import { createRecordingDeadLetterSender } from "./helpers/dead-letters.ts";
import { buildValidMessage } from "./helpers/messages.ts";

// An outage must never dead-letter good data: the batch handler rethrows it as
// retryable, so nothing is committed and the restart reads the batch again.
// A real outage throws one of two errors, and each takes its own branch of
// classifyPostgresError.
//
// The two tests share one database, in order: the first stops it, and the
// second runs against it stopped.

function isRetryableError(error: unknown) {
	return error instanceof RetryableError;
}

// The lock holder's connection dies with the container too
function ignoreClientError() {}

function buildAnyValidMessage() {
	return buildValidMessage(
		buildCardRecord({ transactionId: randomUUID(), customerId: randomUUID() }),
		0n
	);
}

/** Waits until a lock request is queued: the consumer's INSERT, blocked */
async function waitForWaitingLock(adminPool: Pool) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const result = await adminPool.query(
			"SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted"
		);
		if (result.rows[0]?.waiting > 0) return;
		await setTimeout(100);
	}
	throw new Error("The INSERT never waited on the lock");
}

suite("a database outage", () => {
	let database: TestDatabase;
	let handleTransactionBatch: BatchHandler;
	const deadLetters: DeadLetterFailure[] = [];

	before(
		async () => {
			database = await startTestDatabase();
			// Read as admin, so the consumer's pool opens its first connection
			// inside the first test. node:test reports an error from a connection
			// against whichever test or hook opened it.
			const ruleset = await loadRuleset(createDatabase(database.adminPool));
			handleTransactionBatch = createTransactionBatchHandler(
				createTransactionIngester("card", ruleset, database.consumerPool),
				createRecordingDeadLetterSender(deadLetters)
			);
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		// The first test stopped the container
		await closeTestDatabasePools(database);
	});

	test("the database dying during an insert fails the flush as retryable and dead-letters nothing", async () => {
		// admin holds a lock the INSERT must wait for, so the database stops
		// while the consumer's statement is in flight, however fast the machine
		const lockHolder = await database.adminPool.connect();
		lockHolder.on("error", ignoreClientError);
		try {
			await lockHolder.query("BEGIN");
			await lockHolder.query("LOCK TABLE txn_agg.transactions IN SHARE MODE");

			// The assertion is attached before the stop: a rejection nothing is
			// waiting for yet is an unhandled rejection, which fails the test for
			// the wrong reason
			const flushFailure = assert.rejects(
				handleTransactionBatch([buildAnyValidMessage()]),
				isRetryableError
			);
			await waitForWaitingLock(database.adminPool);
			await database.container.stop();

			await flushFailure;
			assert.strictEqual(deadLetters.length, 0);
		} finally {
			// Released with an error so the pool discards it rather than reusing
			// it; a client still checked out would keep the pool from ending
			lockHolder.release(true);
		}
	});

	test("the database being down when a batch arrives fails the flush as retryable and dead-letters nothing", async () => {
		await assert.rejects(
			handleTransactionBatch([buildAnyValidMessage()]),
			isRetryableError
		);
		assert.strictEqual(deadLetters.length, 0);
	});
});
