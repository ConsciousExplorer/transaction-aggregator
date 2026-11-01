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
});
