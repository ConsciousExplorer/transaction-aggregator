import type { FastifyInstance, InjectOptions } from "fastify";
import type { TokenVerification } from "#src/auth/verifier.ts";
import { buildServer, type ServerDependencies } from "#src/server.ts";
import type { TestDatabase } from "./database.ts";
import { buildRepositories } from "./repositories.ts";

/**
 * The whole API as app.ts builds it, plugins and routes included, on the test
 * database and trusting the test signing keys.
 */
export async function buildTestServer(
	database: TestDatabase,
	tokenVerification: TokenVerification
) {
	const repositories = buildRepositories(database.apiDatabase);

	const serverDependencies: ServerDependencies = {
		tokenVerification,
		pool: database.apiPool,
		categoryRepository: repositories.categoryRepository,
		transactionRepository: repositories.transactionRepository,
		summaryRepository: repositories.summaryRepository,
		queryWindow: { maxDays: 366 }
	};

	const server = buildServer({ ...serverDependencies, autoload: true });
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
	const request: InjectOptions = {
		method,
		url,
		headers: buildBearerHeaders(token)
	};
	if (payload !== undefined) {
		request.payload = payload;
	}
	return server.inject(request);
}
