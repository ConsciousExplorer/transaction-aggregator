import assert from "node:assert";
import { mock, suite, test } from "node:test";
import type { Pool } from "pg";
import {
	buildCardRecord,
	castToDomainTransaction
} from "#src/services/test-records.ts";
import { createTransactionIngester } from "#src/services/transaction-ingester.ts";

// No rules, so every transaction takes the fallback verdict.
const EMPTY_RULESET = { version: 1, rules: [], uncategorisedId: 1 };

suite("transaction ingestion", () => {
	test("a valid transaction is inserted inside one database transaction", async () => {
		const query = mock.fn(async (_text: string, _values?: unknown[]) => ({
			rows: [],
			rowCount: 1
		}));
		const pool = {
			async connect() {
				return { query, release() {} };
			}
		} as unknown as Pool;

		const ingestTransactions = createTransactionIngester(
			"card",
			EMPTY_RULESET,
			pool
		);

		const outcome = await ingestTransactions([
			castToDomainTransaction(buildCardRecord())
		]);

		assert.deepEqual(outcome, { attempted: 1, inserted: 1 });

		const statements = [];
		for (const call of query.mock.calls) {
			statements.push(call.arguments[0]);
		}
		assert.equal(statements.length, 3);
		assert.equal(statements[0], "BEGIN");
		assert.match(statements[1] ?? "", /INSERT INTO transactions/);
		assert.equal(statements[2], "COMMIT");
	});
});
