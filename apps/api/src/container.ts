import { join } from "node:path";
import { asFunction, asValue, createContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { ConfigSchema } from "#src/config.ts";
import { createPool } from "#src/integrations/database/pool.ts";
import { baseLogger, config } from "#src/runtime.ts";
import { buildServer } from "#src/server.ts";

type AppCradle = {
	config: ConfigSchema;
	logger: Logger;
	database: Pool;
	server: FastifyInstance;
};

export async function buildContainer() {
	// Create the application container
	const container = createContainer<AppCradle>();

	const database: Pool = await createPool({
		min: config.database.min,
		max: config.database.max,
		database: config.database.database,
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.secrets.database_password
	});

	container.register({
		config: asValue(config),

		logger: asValue(baseLogger),

		database: asFunction(() => database)
			.singleton()
			.disposer((pool: Pool) => pool.end()),

		server: asFunction(
			({ config, logger, database }): FastifyInstance =>
				buildServer({
					// SYNC — register() only queues plugins (§3)
					serverOptions: {},
					dependencies: {
						config,
						logger,
						database, // ← threads into autoload (§3)
						autoLoadParameters: {
							dir: join(import.meta.dirname, "routes"),
							dirNameRoutePrefix: true,
							routeParams: true,
							matchFilter: /route\.(ts|js)$/
						}
					}
				})
		)
			.singleton()
			.disposer((app) => app.close()) // FastifyInstance
	});

	return container;
}
