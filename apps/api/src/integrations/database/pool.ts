import type { NodePgClient } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Logger } from "pino";

export type Queryable = NodePgClient; // Pool | PoolClient | Client

export function createPool(config: PoolConfig, logger: Logger) {
	const pool = new Pool({
		min: 3,
		max: 20,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
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

	pool.on("error", (err) => {
		logger.error({ err }, "Idle client error.");
	});

	return pool;
}

// TODO: Move to errors
export function isForeignKeyViolation(error: unknown): boolean {
	let current = error;
	while (typeof current === "object" && current !== null) {
		if ((current as { code?: unknown }).code === "23503") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
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
