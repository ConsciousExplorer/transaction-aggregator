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
 */
export function createPool(config: PoolConfig) {
	const pool = new Pool({
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		// Without the two timeouts an INSERT that never gets an answer waits
		// forever: the flush never ends, the loop pulls nothing more, and the
		// heartbeats keep the partitions. Either one fails the batch as
		// retryable instead, so the process exits uncommitted and the restart
		// reads the batch again.
		//
		// The server cancels a statement that runs, or waits on a lock, too long
		statement_timeout: 25_000,
		// A connection whose server is gone without a reset never answers at
		// all; this timeout runs in the client, so it fails that query too.
		query_timeout: 30_000,
		// Probes an idle connection after 10 s, so a dead one is dropped from
		// the pool instead of being handed to the next batch
		keepAlive: true,
		keepAliveInitialDelayMillis: 10_000,
		...config
	});

	pool.on("error", (error) => {
		logger.error({ err: error }, "Idle client error");
	});

	return pool;
}
