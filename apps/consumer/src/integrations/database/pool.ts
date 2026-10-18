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

export async function createPool(config: PoolConfig) {
	const pool = new Pool({
		min: 3,
		max: 20,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		...config
	});

	pool.on("error", (err) => {
		logger.error({ err }, "Idle client error");
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
	fn: (client: PoolClient) => Promise<T>
) {
	const client = await pool.connect();
	client.on("error", ignoreCheckedOutClientError);
	try {
		await client.query("BEGIN");
		const result = await fn(client);
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
