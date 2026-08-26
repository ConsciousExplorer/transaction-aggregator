import { join } from "node:path";
import { asValue, createContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createPool } from "./integrations/database/pool.ts";
import { baseLogger, config } from "./runtime.ts";
import { buildServer } from "./server.ts";

const logger = baseLogger;

const container = createContainer();

let server: FastifyInstance;
let writerPool: Pool;

try {
	// Create database pool to manage connections
	writerPool = await createPool({
		min: config.database.min,
		max: config.database.max,
		database: config.database.database,
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.secrets.database_password
	});

	server = await buildServer({
		serverOptions: {},
		dependencies: {
			config: config,
			logger: baseLogger,
			autoLoadParameters: {
				dir: join(import.meta.dirname, "routes"),
				dirNameRoutePrefix: true,
				routeParams: true,
				matchFilter: /route\.(ts|js)$/
			}
		}
	});

	// Register dependecies
	container.register({
		database: asValue(writerPool)
	});
} catch (error) {
	logger.error(error, "Something broke here");
	process.exit(1);
}

server.listen({ port: config.app.port });
