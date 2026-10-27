import { Pool, type PoolConfig } from "pg";
import type { Logger } from "pino";

/**
 * Size and timeouts come from config. Keep-alive is always on, so an idle
 * connection whose server has gone is found and dropped.
 */
export function createPool(config: PoolConfig, logger: Logger) {
	const pool = new Pool({ ...config, keepAlive: true });

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
