import { type AutoloadPluginOptions, fastifyAutoload } from "@fastify/autoload";

import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from "@fastify/type-provider-zod";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import fastify from "fastify";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { ConfigSchema } from "./config.ts";
import { problemJson } from "./plugins/problem-json.ts";
import { swaggerPlugin } from "./plugins/swagger.ts";

export type AutoLoadParameters = {
	routesDirectories: string;
	dirNameRoutePrefix: boolean;
	matchFilter: string;
};

export type ServerDependencies = {
	config: ConfigSchema;
	logger: Logger;
	database: Pool;
	autoLoadParameters: AutoloadPluginOptions;
};

export function buildServer({
	serverOptions,
	dependencies
}: {
	serverOptions: FastifyServerOptions;
	dependencies: ServerDependencies;
}): FastifyInstance {
	const server = fastify({
		loggerInstance: dependencies.logger,
		...serverOptions
	}).withTypeProvider<ZodTypeProvider>();

	// TODO: Explain what this means?
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	// used to log problems based on RFC
	server.register(problemJson, dependencies);

	// OpenAPI spec
	server.register(swaggerPlugin, dependencies);

	server.register(fastifyAutoload, {
		...dependencies.autoLoadParameters,
		options: { database: dependencies.database, config: dependencies.config }
	});

	// await app.register(metricsPlugin, deps); // TODO: Enable for metrics

	// rewrite / to /docs
	server.get("/", {
		schema: { hide: true },
		handler: async (_request, reply) => {
			reply.redirect("/docs");
		}
	});

	return server;
}
