import { asClass, asFunction, asValue, createContainer } from "awilix";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { AppInfoConfig, Config } from "#src/config.ts";
import { createPool } from "#src/integrations/database/pool.ts";
import { QueryPlanLogger } from "#src/integrations/database/query-logger.ts";
import { appInfo, baseLogger, config, secrets } from "#src/runtime.ts";
import { createTokenVerifier, type TokenVerifier } from "./auth/verifier.ts";
import { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";
import { SummaryRepository } from "./integrations/database/repositories/summary-repository.ts";
import { UserTransactionRepository } from "./integrations/database/repositories/transaction-repository.ts";

// Define what the repositories contain

export type AppCradle = {
	appInfo: AppInfoConfig;
	config: Config;
	logger: Logger;
	tokenVerifier: TokenVerifier;
	database: Pool;
	db: NodePgDatabase;
	categoryRepository: CategoryRepository;
	transactionRepository: UserTransactionRepository;
	summaryRepository: SummaryRepository;
};

export async function buildContainer() {
	// Create the application container
	const container = createContainer<AppCradle>();

	container.register({
		appInfo: asValue(appInfo),

		config: asValue(config),

		logger: asValue(baseLogger),

		tokenVerifier: asFunction(({ config }: AppCradle) =>
			createTokenVerifier(config.auth)
		).singleton(),

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
			}),

		// One drizzle instance for every repository. DATABASE_QUERY_LOG (development
		// only) logs each statement it sends, and in plan mode its plan.
		db: asFunction(({ config, database, logger }: AppCradle) => {
			const queryLog = config.database.queryLog;
			if (queryLog === "off") {
				return drizzle(database);
			}
			const queryLogger = new QueryPlanLogger(
				database,
				logger.child({ module: "query-logger" }),
				queryLog
			);
			return drizzle(database, { logger: queryLogger });
		}).singleton(),

		categoryRepository: asClass(CategoryRepository),

		transactionRepository: asClass(UserTransactionRepository),

		summaryRepository: asClass(SummaryRepository)
	});

	return container;
}
