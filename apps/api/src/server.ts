import { type AutoloadPluginOptions, fastifyAutoload } from "@fastify/autoload";
import {
	hasZodFastifySchemaValidationErrors,
	isResponseSerializationError,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider
} from "@fastify/type-provider-zod";
import fastify, {
	type FastifyError,
	type FastifyInstance,
	type FastifyReply,
	type FastifyServerOptions
} from "fastify";
import type { Pool } from "pg";
import { type Logger, pino } from "pino";

import type { AppInfoConfig } from "./config.ts";
import {
	fromStatus,
	HttpProblem,
	internal,
	notFound,
	validationError
} from "./errors/http-problem.ts";
import type { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";
import type { SummaryRepository } from "./integrations/database/repositories/summary-repository.ts";
import type { UserTransactionRepository } from "./integrations/database/repositories/transaction-repository.ts";

export type BuildServerOptions = {
	serverOptions?: FastifyServerOptions;
	appInfo?: AppInfoConfig;
	logger?: Logger;
	database?: Pool;
	categoryRepository?: CategoryRepository;
	transactionRepository?: UserTransactionRepository;
	summaryRepository?: SummaryRepository;
	pluginAutoLoadParameters?: AutoloadPluginOptions & {
		enableSwagger?: boolean;
	};
	routeAutoLoadParameters?: AutoloadPluginOptions;
};

/**
 * Everything is optional: buildServer({}) boots a working server with defaults
 * (pure config, silent logger, no routes). Production (app.ts) passes the real
 * dependencies explicitly; tests pass only what they exercise and register
 * routes manually with exactly the opts those routes need.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
	const logger = options.logger ?? pino({ level: "silent" });

	const appInfo = {
		name: "api",
		version: "0.0.0",
		description: "",
		author: "",
		...options.appInfo
	};

	const serverOptions = options.serverOptions ?? {};

	const {
		pluginAutoLoadParameters,
		routeAutoLoadParameters,
		database,
		categoryRepository,
		transactionRepository,
		summaryRepository
	} = options;

	const server = fastify({
		loggerInstance: logger,
		...serverOptions
	}).withTypeProvider<ZodTypeProvider>();

	// Zod owns request validation and response serialization
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	// Setting error handlers
	server.setErrorHandler((err: FastifyError, req, reply) => {
		const log = req.log.child({ method: req.method, url: req.url });

		if (err instanceof HttpProblem) {
			if (err.payload.status >= 500) {
				log.error({ problem: err.payload }, "problem");
			} else {
				log.warn({ problem: err.payload }, "problem");
			}
			return send(reply, err);
		}
		if (hasZodFastifySchemaValidationErrors(err)) {
			const problem = validationError(err.validation);
			log.warn({ problem: problem.payload }, "problem");
			return send(reply, problem);
		}
		if (isResponseSerializationError(err)) {
			log.error({ err }, "response schema violation");
			return send(reply, internal(req.id));
		}
		const status = err.statusCode;
		if (typeof status === "number" && status >= 400 && status < 500) {
			log.warn({ err }, "client error");
			return send(reply, fromStatus(status, err.message));
		}
		log.error({ err }, "unhandled");
		return send(reply, internal(req.id));
	});

	server.setNotFoundHandler((_req, reply) => send(reply, notFound()));

	// // OpenAPI spec + /docs
	if (pluginAutoLoadParameters) {
		server.register(fastifyAutoload, {
			...pluginAutoLoadParameters,
			options: {
				appInfo,
				enableSwagger: pluginAutoLoadParameters.enableSwagger
			}
		});
	}

	// No autoLoadParameters → no autoload: the server carries zero routes and
	// the caller registers what it wants (this is what route tests do).
	if (routeAutoLoadParameters) {
		server.register(fastifyAutoload, {
			...routeAutoLoadParameters,
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

function send(reply: FastifyReply, problem: HttpProblem) {
	if (problem.payload.retryAfter)
		reply.header("retry-after", problem.payload.retryAfter);
	return reply
		.code(problem.payload.status)
		.type("application/problem+json")
		.send(problem.payload);
}
