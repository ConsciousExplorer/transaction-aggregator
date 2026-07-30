/**
 * App main entrypoint
 *
 *
 */
import process from "node:process";
import type { Pool } from "pg";
import { createPool } from "./integrations/database/postgres.ts";

// Dependencies
let writerPool: Pool;

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

export async function gracefulShudown() {
	// TODO: Determine how to pass singletons here and in which order they should be stopped
	await writerPool?.end();
}

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000)),
);

try {
	// Create database pool to manage connections
	writerPool = await startupCheck("PostgreSQL", () =>
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

	console.log(await writerPool.query("Select 1=1"));
} catch (error) {
	console.error("Startup failed", error);
}

// #region Graceful shutdown
process.on("SIGTERM", gracefulShudown());
