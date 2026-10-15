import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildContainer } from "#src/container.ts";
import { buildServer, type ServerDependencies } from "./server.ts";

const container = await buildContainer();

const {
	appInfo,
	config,
	logger,
	tokenVerification,
	database,
	categoryRepository,
	transactionRepository,
	summaryRepository
} = container.cradle;

// Typed so a dependency left out here fails to compile
const serverDependencies: ServerDependencies = {
	tokenVerification: tokenVerification,
	database: database,
	categoryRepository: categoryRepository,
	transactionRepository: transactionRepository,
	summaryRepository: summaryRepository,
	queryWindow: config.queryWindow
};

const server: FastifyInstance = buildServer({
	...serverDependencies,
	appInfo: appInfo,
	logger: logger,
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
	logger.info({ event: "app.start", port: config.app.port });
	const { secretsSpec, ...configToLog } = config;
	logger.debug({ config: configToLog }, "Starting server with configuration");
	logger.debug(`Registered routes\n${server.printRoutes()}`);
} catch (err) {
	logger.error({ err }, "boot failed");
	await container.dispose();
	process.exit(1);
}

process.on("SIGTERM", () => shutDownGracefully());
process.on("SIGINT", () => shutDownGracefully());

export async function shutDownGracefully(code = 0) {
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
