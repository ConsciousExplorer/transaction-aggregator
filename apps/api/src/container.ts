import { asClass, asFunction, asValue, createContainer } from "awilix";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { AppInfoConfig, Config } from "#src/config.ts";
import { createPool, endPool } from "#src/integrations/database/pool.ts";
import { QueryPlanLogger } from "#src/integrations/database/query-logger.ts";
import { appInfo, baseLogger, config, secrets } from "#src/runtime.ts";
import {
	buildTokenVerification,
	type TokenVerification
} from "./auth/verifier.ts";
import { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";
import { SummaryRepository } from "./integrations/database/repositories/summary-repository.ts";
import { UserTransactionRepository } from "./integrations/database/repositories/transaction-repository.ts";

/** Everything the container builds, by the name it is resolved by */
export type AppCradle = {
	appInfo: AppInfoConfig;
	config: Config;
	logger: Logger;
	tokenVerification: TokenVerification;
	pool: Pool;
	database: NodePgDatabase;
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

		tokenVerification: asFunction(({ config }: AppCradle) =>
			buildTokenVerification(config.auth)
		).singleton(),

		pool: asFunction(({ config, logger }: AppCradle) =>
			createPool(
				{
					min: config.database.min,
					max: config.database.max,
					database: config.database.database,
					host: config.database.host,
					port: config.database.port,
					user: config.database.user,
					password: secrets.databasePassword,
					idleTimeoutMillis: config.database.idleTimeout,
					connectionTimeoutMillis: config.database.connectionTimeout,
					statement_timeout: config.database.statementTimeout,
					query_timeout: config.database.queryTimeout,
					keepAliveInitialDelayMillis: config.database.keepAliveDelay
				},
				logger
			)
		)
			.singleton()
			.disposer(endPool),

		// One drizzle instance for every repository. DATABASE_QUERY_LOG_SQL or
		// DATABASE_QUERY_LOG_PLAN logs each statement it sends.
		database: asFunction(({ config, pool, logger }: AppCradle) => {
			const queryLog = config.database.queryLog;
			if (!queryLog.sql && !queryLog.plan) {
				return drizzle(pool);
			}
			const queryLogger = new QueryPlanLogger(
				pool,
				logger.child({ module: "query-logger" }),
				queryLog
			);
			return drizzle(pool, { logger: queryLogger });
		}).singleton(),

		categoryRepository: asClass(CategoryRepository),

		transactionRepository: asClass(UserTransactionRepository),

		summaryRepository: asClass(SummaryRepository)
	});

	return container;
}
