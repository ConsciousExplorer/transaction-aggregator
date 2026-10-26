import { join } from "node:path";
import { fastifyAutoload } from "@fastify/autoload";
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
	appInfo?: AppInfoConfig;
	logger?: Logger;
	// Loads the plugins and routes folders beside this file. Off, the server
	// has no routes and the caller registers what it wants, as route tests do.
	autoload?: boolean;
	enableSwagger?: boolean;
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

	const {
		pool,
		categoryRepository,
		transactionRepository,
		summaryRepository,
		queryWindow
	} = options;

	// Typed as Fastify's own options, so the server is a plain FastifyInstance.
	// Left to inference, pino's Logger type becomes part of the server's type,
	// and a caller that declares a FastifyInstance can't hold it.
	const serverOptions: FastifyServerOptions = {
		loggerInstance: logger,
		logController: new LogController({ disableRequestLogging: true }),
		genReqId: resolveTraceId
	};

	const server = fastify(serverOptions).withTypeProvider<ZodTypeProvider>();

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

	if (options.autoload) {
		// Auth, the audit line, and the OpenAPI spec with /docs
		server.register(fastifyAutoload, {
			dir: join(import.meta.dirname, "plugins"),
			ignoreFilter: IGNORE_TEST_FILES,
			options: {
				appInfo,
				enableSwagger: options.enableSwagger ?? false,
				tokenVerification: options.tokenVerification
			}
		});

		server.register(fastifyAutoload, {
			dir: join(import.meta.dirname, "routes"),
			// A folder named _userId is the :userId route parameter
			routeParams: true,
			// Only <operation>.route.ts files are routes: the schemas, mappers
			// and tests beside them are not
			matchFilter: /route\.(ts|js)$/,
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
