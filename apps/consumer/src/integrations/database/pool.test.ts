import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { createPool } from "./pool.ts";

suite("createPool", () => {
	// Without these an INSERT that never gets an answer stalls the consumer
	// while its heartbeats keep the partitions: a timeout turns the hang into a
	// retryable failure, and the restart reads the batch again
	test("bounds every statement on the server and in the client, and probes idle connections", async () => {
		const pool = createPool({});

		try {
			const { statement_timeout, query_timeout, keepAlive } = pool.options;
			assert.strictEqual(typeof statement_timeout, "number");
			assert.strictEqual(typeof query_timeout, "number");
			// The server cancels first, so a lock wait fails as 57014 and the
			// client-side timeout is left for a connection that never answers
			assert.ok(Number(statement_timeout) < Number(query_timeout));
			assert.strictEqual(keepAlive, true);
		} finally {
			await pool.end();
		}
	});
});
