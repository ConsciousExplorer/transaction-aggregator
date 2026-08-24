import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from "@fastify/type-provider-zod";
import fastify from "fastify";
import type { Logger } from "pino";
import type { ConfigSchema } from "./config.ts";
import { problemJson } from "./plugins/problem-json.ts";
import { swaggerPlugin } from "./plugins/swagger.ts";

export type ServerDependencies = {
	config: ConfigSchema;
	logger: Logger;
};

export async function buildServer(dependencies: ServerDependencies) {
	const server = fastify({
		loggerInstance: dependencies.logger
	}).withTypeProvider<ZodTypeProvider>();

	// TODO: Explain what this means?
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	// used to log problems based on RFC
	await server.register(problemJson, dependencies);

	// OpenAPI spec
	await server.register(swaggerPlugin, dependencies);

	// await app.register(metricsPlugin, deps); // TODO: Enable for metrics

	return server;
}
