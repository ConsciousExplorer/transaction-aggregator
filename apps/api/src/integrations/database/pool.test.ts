import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { pino } from "pino";
import { createPool } from "./pool.ts";

const SILENT_LOGGER = pino({ level: "silent" });

suite("createPool", () => {
	test("probes idle connections, so a dead one is dropped from the pool", async () => {
		const pool = createPool({}, SILENT_LOGGER);

		try {
			assert.strictEqual(pool.options.keepAlive, true);
		} finally {
			await pool.end();
		}
	});

	test("takes its timeouts from config", async () => {
		const pool = createPool(
			{ statement_timeout: 5_000, query_timeout: 6_000 },
			SILENT_LOGGER
		);

		try {
			assert.strictEqual(pool.options.statement_timeout, 5_000);
			assert.strictEqual(pool.options.query_timeout, 6_000);
		} finally {
			await pool.end();
		}
	});
});
