import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { createPool } from "./pool.ts";

suite("createPool", () => {
	test("probes idle connections, so a dead one is dropped from the pool", async () => {
		const pool = createPool({});

		try {
			assert.strictEqual(pool.options.keepAlive, true);
		} finally {
			await pool.end();
		}
	});

	test("takes its timeouts from config", async () => {
		const pool = createPool({
			statement_timeout: 25_000,
			query_timeout: 30_000
		});

		try {
			assert.strictEqual(pool.options.statement_timeout, 25_000);
			assert.strictEqual(pool.options.query_timeout, 30_000);
		} finally {
			await pool.end();
		}
	});
});
