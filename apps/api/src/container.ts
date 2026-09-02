import { asClass, asFunction, asValue, createContainer } from "awilix";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { AppInfoConfig, Config } from "#src/config.ts";
import { createPool } from "#src/integrations/database/pool.ts";
import { appInfo, baseLogger, config, secrets } from "#src/runtime.ts";
import { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";

// Define what the repositories contain

export type AppCradle = {
	appInfo: AppInfoConfig;
	config: Config;
	logger: Logger;
	database: Pool;
	categoryRepository: CategoryRepository;
};

export async function buildContainer() {
	// Create the application container
	const container = createContainer<AppCradle>();

	container.register({
		appInfo: asValue(appInfo),

		config: asValue(config),

		logger: asValue(baseLogger),

		categoryRepository: asClass(CategoryRepository, { lifetime: "SCOPED" }),

		database: asFunction(({ config, logger }: AppCradle) =>
			createPool(
				{
					min: config.database.min,
					max: config.database.max,
					database: config.database.database,
					host: config.database.host,
					port: config.database.port,
					user: config.database.user,
					password: secrets.databasePassword
				},
				logger
			)
		)
			.singleton()
			.disposer(async (pool) => {
				pool.end();
			})
	});

	return container;
}
