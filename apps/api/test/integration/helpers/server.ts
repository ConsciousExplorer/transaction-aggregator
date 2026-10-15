import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { TokenVerification } from "#src/auth/verifier.ts";
import { buildServer } from "#src/server.ts";
import type { TestDatabase } from "./database.ts";
import { buildRepositories } from "./repositories.ts";

const SOURCE_DIRECTORY = join(import.meta.dirname, "../../../src");

/**
 * The whole API as app.ts builds it, with the plugins and routes autoloaded
 * with app.ts's options, on the test database and trusting the test signing
 * keys. Keep the autoload options in step with app.ts.
 */
export async function buildTestServer(
	database: TestDatabase,
	tokenVerification: TokenVerification
) {
	const repositories = buildRepositories(database.apiDb);

	const server = buildServer({
		tokenVerification,
		database: database.apiPool,
		categoryRepository: repositories.categoryRepository,
		transactionRepository: repositories.transactionRepository,
		summaryRepository: repositories.summaryRepository,
		queryWindow: { maxDays: 366 },
		pluginAutoLoadParameters: {
			dir: join(SOURCE_DIRECTORY, "plugins"),
			enableSwagger: false
		},
		routeAutoLoadParameters: {
			dir: join(SOURCE_DIRECTORY, "routes"),
			dirNameRoutePrefix: true,
			routeParams: true,
			matchFilter: /route\.(ts|js)$/
		}
	});
	await server.ready();
	return server;
}

function buildBearerHeaders(token: string) {
	return { authorization: `Bearer ${token}` };
}

/** A GET with the token, the way a client calls the API */
export function readAs(server: FastifyInstance, token: string, url: string) {
	return server.inject({
		method: "GET",
		url,
		headers: buildBearerHeaders(token)
	});
}

/** A PUT or DELETE with the token */
export function sendAs(
	server: FastifyInstance,
	token: string,
	method: "PUT" | "DELETE",
	url: string,
	payload?: object
) {
	return server.inject({
		method,
		url,
		headers: buildBearerHeaders(token),
		...(payload !== undefined && { payload })
	});
}
