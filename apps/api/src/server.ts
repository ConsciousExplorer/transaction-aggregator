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
	type FastifyReply,
	type FastifyServerOptions,
	LogController
} from "fastify";
import type { Pool } from "pg";
import { type Logger, pino } from "pino";
import type { TokenVerification } from "./auth/verifier.ts";
import type { AppInfoConfig, QueryWindowConfig } from "./config.ts";
import {
	clientError,
	HttpProblem,
	internalError,
	notFoundError,
	validationError
} from "./errors/http-problem.ts";
import type { CategoryRepository } from "./integrations/database/repositories/category-repository.ts";
import type { SummaryRepository } from "./integrations/database/repositories/summary-repository.ts";
import type { UserTransactionRepository } from "./integrations/database/repositories/transaction-repository.ts";
import httpMetrics from "./telemetry/http-metrics.ts";
import { resolveTraceId } from "./utils/trace-id.ts";

// Tests live next to the code they test. Autoload would otherwise register a
// test file as a plugin or route and run its suite inside the server.
const IGNORE_TEST_FILES = /\.test\.(ts|js)$/;

/**
 * Everything the autoloaded plugins and routes read from their options.
 * Autoload doesn't type-check the options it hands each route, so a caller
 * that serves real requests types its dependencies with this: leaving one out
 * is then a compile error, not a 500 on that route's first request.
 */
export type ServerDependencies = {
	tokenVerification: TokenVerification;
	pool: Pool;
	categoryRepository: CategoryRepository;
	transactionRepository: UserTransactionRepository;
	summaryRepository: SummaryRepository;
	queryWindow: QueryWindowConfig;
};

export type BuildServerOptions = Partial<ServerDependencies> & {
	serverOptions?: FastifyServerOptions;
	appInfo?: AppInfoConfig;
	logger?: Logger;
	pluginAutoLoadParameters?: AutoloadPluginOptions & {
		enableSwagger?: boolean;
	};
	routeAutoLoadParameters?: AutoloadPluginOptions;
};

/**
 * Everything is optional: buildServer({}) boots a working server with defaults
 * (pure config, silent logger, no routes). Production (app.ts) and the
 * integration tests pass a complete ServerDependencies; unit tests and the
 * OpenAPI script pass only what they exercise, since they never send a request
 * to a route that reads a repository.
 */
export function buildServer(options: BuildServerOptions = {}) {
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
		pool,
		categoryRepository,
		transactionRepository,
		summaryRepository,
		queryWindow
	} = options;

	const server = fastify({
		loggerInstance: logger,
		logController: new LogController({ disableRequestLogging: true }),
		genReqId: resolveTraceId,
		...serverOptions
	}).withTypeProvider<ZodTypeProvider>();

	/**
	 * Zod owns request validation and response serialization
	 */
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	/**
	 *  Setting error handlers
	 */
	server.setErrorHandler((error: FastifyError, request, reply) => {
		const log = request.log.child({ method: request.method, url: request.url });

		if (error instanceof HttpProblem) {
			if (error.payload.status >= 500) {
				log.error({ problem: error.payload }, "problem");
			} else {
				log.warn({ problem: error.payload }, "problem");
			}
			return send(reply, error);
		}
		if (hasZodFastifySchemaValidationErrors(error)) {
			const problem = validationError(error.validation);
			log.warn({ problem: problem.payload }, "problem");
			return send(reply, problem);
		}
		if (isResponseSerializationError(error)) {
			log.error({ err: error }, "response schema violation");
			return send(reply, internalError(request.id));
		}
		const status = error.statusCode;
		if (typeof status === "number" && status >= 400 && status < 500) {
			log.warn({ err: error }, "client error");
			return send(reply, clientError(status, error.message));
		}
		log.error({ err: error }, "unhandled");
		return send(reply, internalError(request.id));
	});

	server.setNotFoundHandler((_request, reply) => send(reply, notFoundError()));

	/**
	 * RED metrics and the trace span's route for every request.
	 * Rate
	 * Error
	 * Duration
	 */
	server.register(httpMetrics);

	/**
	 * Plugin autoload
	 * Autoload every plugin in the specified directory
	 *
	 * OpenAPI spec + /docs
	 */
	if (pluginAutoLoadParameters) {
		server.register(fastifyAutoload, {
			...pluginAutoLoadParameters,
			ignoreFilter: IGNORE_TEST_FILES,
			options: {
				appInfo,
				enableSwagger: pluginAutoLoadParameters.enableSwagger,
				tokenVerification: options.tokenVerification
			}
		});
	}

	/**
	 * No autoLoadParameters → no autoload: the server carries zero routes and
	 * the caller registers what it wants (this is what route tests do).
	 */
	if (routeAutoLoadParameters) {
		server.register(fastifyAutoload, {
			...routeAutoLoadParameters,
			ignoreFilter: IGNORE_TEST_FILES,
			options: {
				pool,
				categoryRepository,
				transactionRepository,
				summaryRepository,
				queryWindow
			}
		});
	}

	/**  rewrite / to /docs */
	server.get("/", {
		schema: { hide: true },
		config: { authConfig: { public: true } },
		handler: async (_request, reply) => {
			reply.redirect("/docs");
		}
	});

	/**
	 * Returns the actual server instance, which is a FastifyInstance with all the plugins and routes registered.
	 * The caller can then call server.listen() to start the server.
	 */
	return server;
}

// #region: Helpers

/**
 * Helpers to send a problem+json response.
 * The FastifyReply type is used to ensure that the reply object is correctly typed
 * The response is sent with the correct status code and content type.
 */
function send(reply: FastifyReply, problem: HttpProblem) {
	return reply
		.code(problem.payload.status)
		.type("application/problem+json")
		.send(problem.payload);
}

// #endregion
