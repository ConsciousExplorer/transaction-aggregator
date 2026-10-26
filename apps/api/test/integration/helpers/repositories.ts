import { asClass, asValue, createContainer } from "awilix";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AppCradle } from "#src/container.ts";
import { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { SummaryRepository } from "#src/integrations/database/repositories/summary-repository.ts";
import { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";

/**
 * The repositories, registered the way container.ts registers them, on the
 * test database. container.ts itself can't be imported: importing it loads
 * config from the environment and reads secrets from /secrets.
 */
export function buildRepositories(database: NodePgDatabase) {
	const container = createContainer<AppCradle>();
	container.register({
		database: asValue(database),
		categoryRepository: asClass(CategoryRepository),
		transactionRepository: asClass(UserTransactionRepository),
		summaryRepository: asClass(SummaryRepository)
	});

	return {
		categoryRepository: container.resolve("categoryRepository"),
		transactionRepository: container.resolve("transactionRepository"),
		summaryRepository: container.resolve("summaryRepository")
	};
}
