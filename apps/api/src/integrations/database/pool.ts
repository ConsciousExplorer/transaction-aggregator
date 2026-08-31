import type { NodePgClient } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Logger } from "pino";

// Minimal common interface — both Pool and PoolClient satisfy this
// export interface Queryable {
// 	query<T extends QueryResultRow = QueryResultRow>(
// 		text: string,
// 		values?: unknown[]
// 	): Promise<QueryResult<T>>;
// }

export type Queryable = NodePgClient; // Pool | PoolClient | Client

export async function createPool(
	config: PoolConfig,
	logger: Logger
): Promise<Pool> {
	const pool = new Pool({
		min: 3,
		max: 20,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		...config
	});

	// Register listeners
	pool.on("acquire", () => {
		logger.info("Acquired a connection.");
	});

	pool.on("release", () => {
		logger.info("Released a connection.");
	});

	pool.on("connect", () => {
		logger.info("Connected to the database.");
	});

	pool.on("error", (err) => {
		logger.error({ err }, "Idle client error.");
	});

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
