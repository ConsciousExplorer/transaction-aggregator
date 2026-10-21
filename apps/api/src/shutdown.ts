import type { AwilixContainer } from "awilix";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";

/**
 * Stops the API, then exits. The server closes first: it stops taking requests
 * and lets the ones in flight finish while the pool is still open. Disposing
 * the container then ends the pool. Both are awaited, because process.exit
 * ends the process at once and cuts off whatever is still running.
 */
export async function shutDownGracefully(
	server: FastifyInstance,
	container: AwilixContainer,
	logger: Logger,
	code: number
) {
	let exitCode = code;

	try {
		logger.warn("Shutting down services");
		await server.close();
		await container.dispose();
	} catch (error) {
		logger.error({ err: error }, "Error occurred when stopping services.");
		exitCode = 1;
	}

	process.exit(exitCode);
}
