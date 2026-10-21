import type { NodePgClient } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import type { Logger } from "pino";

export type Queryable = NodePgClient; // Pool | PoolClient | Client

export function createPool(config: PoolConfig, logger: Logger) {
	// Pool size (min, max) always comes from config
	const pool = new Pool({
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		// The server cancels a statement that runs or waits on a lock too long
		statement_timeout: 5_000,
		// A connection whose server is gone without a reset never answers, so
		// the server-side timeout never arrives either; this one runs in the
		// client and fails the query a second later
		query_timeout: 6_000,
		// Probes an idle connection after 10 s, so a dead one is dropped from
		// the pool instead of being handed to the next request
		keepAlive: true,
		keepAliveInitialDelayMillis: 10_000,
		...config
	});

	// Register listeners
	pool.on("acquire", () => {
		logger.debug("Acquired a connection.");
	});

	pool.on("release", () => {
		logger.debug("Released a connection.");
	});

	pool.on("connect", () => {
		logger.info("Connected to the database.");
	});

	pool.on("error", (error) => {
		logger.error({ err: error }, "Idle client error.");
	});

	return pool;
}

/**
 * The pool's disposer. It returns pool.end(), so whatever awaits the disposer
 * (the container's dispose()) waits until every connection has closed.
 */
export function endPool(pool: Pool) {
	return pool.end();
}

export function isForeignKeyViolation(error: unknown) {
	let current = error;
	while (typeof current === "object" && current !== null) {
		if ((current as { code?: unknown }).code === "23503") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}
