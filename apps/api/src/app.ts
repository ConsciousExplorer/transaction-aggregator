import { buildContainer } from "#src/container.ts";
import { buildServer, type ServerDependencies } from "./server.ts";
import { shutDownGracefully } from "./shutdown.ts";

const container = await buildContainer();

const {
	appInfo,
	config,
	logger,
	tokenVerification,
	pool,
	categoryRepository,
	transactionRepository,
	summaryRepository
} = container.cradle;

// Typed so a dependency left out here fails to compile
const serverDependencies: ServerDependencies = {
	tokenVerification,
	pool,
	categoryRepository,
	transactionRepository,
	summaryRepository,
	queryWindow: config.queryWindow
};

const server = buildServer({
	...serverDependencies,
	appInfo,
	logger,
	autoload: true,
	enableSwagger: config.api.enableSwagger
});

try {
	await pool.query("SELECT 1");

	// Start the server and start listening for requests
	await server.listen({ host: config.app.host, port: config.app.port });
	logger.info({ event: "app.start", port: config.app.port });
	const { secretsSpec, ...configToLog } = config;
	logger.debug({ config: configToLog }, "Starting server with configuration");
	logger.debug(`Registered routes\n${server.printRoutes()}`);
} catch (error) {
	logger.error({ err: error }, "boot failed");
	await container.dispose();
	process.exit(1);
}

process.on("SIGTERM", () => void shutDownGracefully(server, container, logger));
process.on("SIGINT", () => void shutDownGracefully(server, container, logger));
