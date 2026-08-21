import {
	Pool,
	type PoolClient,
	type PoolConfig,
	type QueryResult,
	type QueryResultRow
} from "pg";
import { fileLogger } from "../../runtime.ts";

const logger = fileLogger(import.meta.url);

// Minimal common interface — both Pool and PoolClient satisfy this
export interface Queryable {
	query<R extends QueryResultRow = QueryResultRow>(
		text: string,
		values?: unknown[]
	): Promise<QueryResult<R>>;
}

export async function createPool(config: PoolConfig): Promise<Pool> {
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

	// Ensure that a connection is established and we can connect
	await pool.query("SELECT 1");

	return pool;
}

export async function withTransaction<T>(
	pool: Pool,
	fn: (client: PoolClient) => Promise<T>
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
