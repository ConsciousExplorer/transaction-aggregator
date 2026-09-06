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

console.log("config", config);

const server: FastifyInstance = buildServer({
	appInfo: appInfo,
	logger: logger,
	database: database,
	categoryRepository: categoryRepository,
	transactionRepository: transactionRepository,
	summaryRepository: summaryRepository,
	pluginAutoLoadParameters: {
		dir: join(import.meta.dirname, "plugins"),
		enableSwagger: config.api.enableSwagger
	},
	routeAutoLoadParameters: {
		dir: join(import.meta.dirname, "routes"),
		dirNameRoutePrefix: true,
		routeParams: true,
		matchFilter: /route\.(ts|js)$/
	}
});

try {
	await database.query("Select 1");

	// Start the server and start listening for requests
	await server.listen({ host: config.app.host, port: config.app.port });
	logger.info(server.printRoutes());
	logger.info({ event: "app.start", port: config.app.port });
} catch (err) {
	logger.error({ err }, "boot failed");
	await container.dispose();
	process.exit(1);
}

process.on("SIGTERM", () => gracefulShutdown());
process.on("SIGINT", () => gracefulShutdown());

export async function gracefulShutdown(code = 0) {
	try {
		logger.warn("Shutting down services");
		server.close();
		container.dispose();
		process.exit(code);
	} catch (error) {
		logger.error({ error }, "Error occurred when stopping services.");
	} finally {
		process.exit(code);
	}
}
