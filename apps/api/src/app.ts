import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildContainer } from "#src/container.ts";
import { buildServer } from "./server.ts";

const container = await buildContainer();

const {
	appInfo,
	config,
	logger,
	database,
	categoryRepository,
	transactionRepository,
	summaryRepository
} = container.cradle;

const server: FastifyInstance = buildServer({
	appInfo: appInfo,
	logger: logger,
	database: database,
	categoryRepository: categoryRepository,
	transactionRepository: transactionRepository,
	summaryRepository: summaryRepository,
	autoLoadParameters: {
		dir: join(import.meta.dirname, "routes"),
		dirNameRoutePrefix: true,
		routeParams: true,
		matchFilter: /route\.(ts|js)$/
	}
});

try {
	// Get the server from the container

	await database.query("Select 1");
	// All the dependencies has been registered. Start listening for requests
	await server.listen({ host: config.app.host, port: config.app.port });
	logger.info({ event: "app.start", port: config.app.port });
} catch (err) {
	logger.error({ err }, "boot failed");
	// drains the pool even on failed boot
	await container.dispose();
	process.exit(1);
}
