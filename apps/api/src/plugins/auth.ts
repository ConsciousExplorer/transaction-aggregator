import type { FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import {
	type AuthContext,
	buildAuthContext,
	hasRequiredScopes,
	type TokenVerification,
	verifyToken
} from "#src/auth/verifier.ts";
import { TokenVerificationError } from "#src/errors/auth-errors.ts";
import {
	authUnavailableError,
	forbiddenError,
	unauthorizedError
} from "#src/errors/http-problem.ts";

declare module "fastify" {
	interface FastifyInstance {
		verifyBearerToken: (request: FastifyRequest) => Promise<void>;
	}
	interface FastifyRequest {
		authContext?: AuthContext;
	}
	interface FastifyContextConfig {
		// Explicit opt-out for routes that must stay reachable without a token (health checks, docs)
		// public?: boolean;
		authConfig?: {
			public?: boolean;
			requiredScope?: string[];
		};
	}
}

async function verifyBearerToken(
	request: FastifyRequest,
	tokenVerification: TokenVerification
) {
	const header = request.headers.authorization;

	if (!header?.startsWith("Bearer ")) {
		request.log.warn(
			{ reason: "missing-or-malformed-header" },
			"auth rejected"
		);
		throw unauthorizedError();
	}

	const token = header.slice("Bearer ".length);

	try {
		const claims = await verifyToken(token, tokenVerification);
		request.authContext = buildAuthContext(claims);
	} catch (error) {
		if (isKeySetUnavailable(error)) {
			request.log.error({ err: error }, "auth unavailable");
			throw authUnavailableError();
		}

		// reason stays internal in logs and not returned in the response
		request.log.warn({ err: error }, "auth rejected");
		throw unauthorizedError();
	}
}

/** The signing keys could not be fetched: no token could be checked */
function isKeySetUnavailable(error: unknown) {
	return (
		error instanceof TokenVerificationError &&
		error.reason === "key-set-unavailable"
	);
}

// onRequest, before validation: a caller without a valid token gets 401,
// never a 400 that describes the route's schema
async function authorizeRequest(request: FastifyRequest) {
	// Routes are guarded by default, can only opt out by setting config : { authConfig: {public: true }}
	if (request.routeOptions.config?.authConfig?.public) return;
	// @fastify/swagger-ui registers its own routes, so they can't carry config.public
	if (request.url.startsWith("/docs")) return;

	await request.server.verifyBearerToken(request);

	const requiredScope = request.routeOptions.config.authConfig?.requiredScope;
	const authContext = request.authContext;
	if (
		requiredScope &&
		(!authContext || !hasRequiredScopes(authContext, requiredScope))
	) {
		request.log.warn(
			{ requiredScope, given: authContext?.scope },
			"Caller does not have the required scopes"
		);
		// The caller is known but not allowed: 403, not 401
		throw forbiddenError();
	}
}

export default fastifyPlugin<{
	tokenVerification: TokenVerification;
}>(
	async (fastify, options) => {
		fastify.decorate("verifyBearerToken", (request: FastifyRequest) =>
			verifyBearerToken(request, options.tokenVerification)
		);

		fastify.addHook("onRequest", authorizeRequest);
	},
	{ name: "auth" }
);
