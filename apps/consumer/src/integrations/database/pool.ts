import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { createFileLogger } from "#src/logger.ts";

const logger = createFileLogger(import.meta.url);

export type Database = NodePgDatabase<Record<string, never>>;

/** Drizzle query builder over the pool, for the ruleset reads. */
export function createDatabase(pool: Pool) {
	return drizzle(pool);
}

/**
 * Every statement goes through `pool.query()`, never a client checked out by
 * hand. While pool.query() holds a client it listens for that client's
 * 'error', so a connection that drops mid-statement rejects the query instead
 * of ending the process on an 'error' nobody listens to.
 *
 * Size and timeouts come from config. Keep-alive is always on, so an idle
 * connection whose server has gone is found and dropped.
 */
export function createPool(config: PoolConfig) {
	const pool = new Pool({ ...config, keepAlive: true });

	pool.on("error", (error) => {
		logger.error({ err: error }, "Idle client error");
	});

	return pool;
}
