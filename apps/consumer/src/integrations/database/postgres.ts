import { Pool, type PoolConfig } from "pg";

export async function createPool(config: PoolConfig): Promise<Pool> {
	const pool = new Pool({
		min: 3,
		max: 20,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		...config
	});

	// Ensure that a connection is established and we can connect
	await pool.query("SELECT 1");

	return pool;
}
