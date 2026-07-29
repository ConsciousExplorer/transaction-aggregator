/**
 * App main entrypoint
 *
 *
 */

import { createPool } from "./integrations/database/postgres.ts";

export async function startupCheck<T>(
	name: string,
	action: () => Promise<T>,
): Promise<T> {
	const start = performance.now();

	try {
		const result = await action();

		console.log(`✓ ${name} (${Math.round(performance.now() - start)}ms)`);

		return result;
	} catch (err) {
		console.log({ err }, `✗ ${name}`);
		process.exit(1);
	}
}

export async shudownCheck<T>()

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000)),
);

const pool = await startupCheck("PostgreSQL", () =>
	createPool({
		min: 3,
		max: 10,
		database: "txn_agg",
		host: "localhost",
		port: 5432,
		user: "admin",
		password: "admin",
	}),
);

console.log(await pool.query("Select 1=1"));

process.on("SIGTERM", gracefulShutdown);
