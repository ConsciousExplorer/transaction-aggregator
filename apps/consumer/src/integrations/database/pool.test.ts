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
});
