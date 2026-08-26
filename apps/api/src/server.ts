import { join } from "node:path";
import fastifyAutoload from "@fastify/autoload";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from "@fastify/type-provider-zod";
import type { FastifyServerOptions } from "fastify";
import fastify from "fastify";
import type { Logger } from "pino";
import type { ConfigSchema } from "./config.ts";
import { problemJson } from "./plugins/problem-json.ts";
import { swaggerPlugin } from "./plugins/swagger.ts";

export type ServerDependencies = {
	config: ConfigSchema;
	logger: Logger;
};

export async function buildServer(
	serverOptions: FastifyServerOptions,
	dependencies: ServerDependencies
) {
	const server = fastify({
		loggerInstance: dependencies.logger,
		...serverOptions
	}).withTypeProvider<ZodTypeProvider>();

	// TODO: Explain what this means?
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	// used to log problems based on RFC
	await server.register(problemJson, dependencies);

	// OpenAPI spec
	await server.register(swaggerPlugin, dependencies);

	await server.register(fastifyAutoload, {
		dir: join(import.meta.dirname, "routes"),
		dirNameRoutePrefix: true,

		matchFilter: /route\.(ts|js)$/
	});

	// await app.register(metricsPlugin, deps); // TODO: Enable for metrics

	return server;
}
