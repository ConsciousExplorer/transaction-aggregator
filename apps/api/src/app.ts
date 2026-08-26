import type { FastifyInstance } from "fastify";
import { buildContainer } from "#src/container.ts";
import { config, baseLogger as logger } from "#src/runtime.ts";

const container = await buildContainer();

try {
	// Get the server from the container
	const server: FastifyInstance = container.cradle.server;

	// All the dependencies has been registered. Start listening for requests
	await server.listen({ host: config.app.host, port: config.app.port });
	logger.info({ event: "app.start", port: config.app.port });
} catch (err) {
	logger.fatal({ err }, "boot failed");
	await container.dispose(); // drains the pool even on failed boot
	process.exit(1);
}
