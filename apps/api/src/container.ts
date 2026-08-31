import { join } from "node:path";
import { asFunction, asValue, createContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { AppInfoConfig, Config } from "#src/config.ts";
import { createPool } from "#src/integrations/database/pool.ts";
import * as categoryRepository from "#src/integrations/database/repositories/category-repository.ts";
import { appInfo, baseLogger, config, secrets } from "#src/runtime.ts";

import { buildServer, type Repositories } from "#src/server.ts";

type AppCradle = {
	appInfo: AppInfoConfig;
	config: Config;
	logger: Logger;
	database: Pool;
	repositories: Repositories;
	server: FastifyInstance;
};

export async function buildContainer() {
	// Create the application container
	const container = createContainer<AppCradle>();

	const database: Pool = await createPool(
		{
			min: config.database.min,
			max: config.database.max,
			database: config.database.database,
			host: config.database.host,
			port: config.database.port,
			user: config.database.user,
			password: secrets.databasePassword
		},
		baseLogger.child({ module: "pool" })
	);

	// Ensure the database can connect by establishing a connection and releasing it again

	await database.query("SELECT 1");

	container.register({
		appInfo: asValue(appInfo),

		config: asValue(config),

		logger: asValue(baseLogger),

		repositories: asValue({ categories: categoryRepository }),

		database: asFunction(() => database)
			.singleton()
			.disposer((pool: Pool) => pool.end()),

		server: asFunction(
			({ appInfo, config, logger, database, repositories }): FastifyInstance =>
				buildServer({
					// SYNC — register() only queues plugins (§3)
					serverOptions: {},
					dependencies: {
						appInfo: appInfo,
						config: config,
						logger: logger,
						database: database,
						repositories: repositories,
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
			.disposer((app) => app.close())
	});

	return container;
}
