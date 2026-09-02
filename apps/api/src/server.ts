import { type AutoloadPluginOptions, fastifyAutoload } from "@fastify/autoload";
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from "@fastify/type-provider-zod";
import fastify, {
	type FastifyInstance,
	type FastifyServerOptions
} from "fastify";
import type { Pool } from "pg";
import { type Logger, pino } from "pino";

import type { AppInfoConfig } from "./config.ts";
import type { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";
import type { SummaryRepository } from "./integrations/database/repositories/summary-repository.ts";
import type { TransactionRepository } from "./integrations/database/repositories/transaction-repository.ts";
import { problemJson } from "./plugins/problem-json.ts";
import { swaggerPlugin } from "./plugins/swagger.ts";

export type BuildServerOptions = {
	serverOptions?: FastifyServerOptions;
	appInfo?: AppInfoConfig;
	logger?: Logger;
	database?: Pool;
	categoryRepository?: CategoryRepository;
	transactionRepository?: TransactionRepository;
	summaryRepository?: SummaryRepository;
	autoLoadParameters?: AutoloadPluginOptions;
};

/**
 * Everything is optional: buildServer({}) boots a working server with defaults
 * (pure config, silent logger, no routes). Production (app.ts) passes the real
 * dependencies explicitly; tests pass only what they exercise and register
 * routes manually with exactly the opts those routes need.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
	const {
		serverOptions = {},
		appInfo = { name: "api", version: "0.0.0", description: "", author: "" },
		logger = pino({ level: "silent" }), // silent default suits tests; app.ts passes the real one
		database,
		categoryRepository,
		transactionRepository,
		summaryRepository,
		autoLoadParameters
	} = options;

	const server = fastify({
		loggerInstance: logger,
		...serverOptions
	}).withTypeProvider<ZodTypeProvider>();

	// Zod owns request validation and response serialization
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	// RFC 9457 problem responses for every error and 404
	server.register(problemJson);

	// OpenAPI spec + /docs
	server.register(swaggerPlugin, { appInfo });

	// No autoLoadParameters → no autoload: the server carries zero routes and
	// the caller registers what it wants (this is what route tests do).
	if (autoLoadParameters) {
		server.register(fastifyAutoload, {
			...autoLoadParameters,
			options: {
				database,
				categoryRepository,
				transactionRepository,
				summaryRepository
			}
		});
	}

	// rewrite / to /docs
	server.get("/", {
		schema: { hide: true },
		handler: async (_request, reply) => {
			reply.redirect("/docs");
		}
	});

	return server;
}
