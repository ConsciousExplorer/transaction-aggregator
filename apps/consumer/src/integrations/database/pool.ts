import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
	Pool,
	type PoolClient,
	type PoolConfig,
	type QueryResult,
	type QueryResultRow
} from "pg";
import { createFileLogger } from "#src/logger.ts";

const logger = createFileLogger(import.meta.url);

// Minimal common interface — both Pool and PoolClient satisfy this
export interface Queryable {
	query<R extends QueryResultRow = QueryResultRow>(
		text: string,
		values?: unknown[]
	): Promise<QueryResult<R>>;
}

export type Database = NodePgDatabase<Record<string, never>>;

/** Drizzle query builder over an existing pool or transaction client. */
export function createDatabase(client: Pool | PoolClient) {
	return drizzle(client);
}

export function createPool(config: PoolConfig) {
	const pool = new Pool({
		min: 3,
		max: 20,
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

/**
 * The pool listens for a client's errors only while the client is idle. A
 * connection that drops mid-statement rejects the query and also emits 'error'
 * on the client, and an 'error' nobody listens to ends the process before the
 * rejection reaches the batch handler. The rejection carries the same error,
 * so the event itself can be ignored.
 */
function ignoreCheckedOutClientError() {}

export async function runInTransaction<T>(
	pool: Pool,
	work: (client: PoolClient) => Promise<T>
) {
	const client = await pool.connect();
	client.on("error", ignoreCheckedOutClientError);
	try {
		await client.query("BEGIN");
		const result = await work(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.removeListener("error", ignoreCheckedOutClientError);
		client.release();
	}
}
