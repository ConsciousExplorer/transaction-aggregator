import type { FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import {
	type AuthContext,
	getAuthScopes,
	getContext,
	type TokenVerifier
} from "#src/auth/verifier.ts";
import { unauthorized } from "#src/errors/http-problem.ts";

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
			requiredScopes?: string[];
		};
	}
}

export default fastifyPlugin<{
	tokenVerifier: TokenVerifier;
}>(
	async (fastify, opts) => {
		const verifier = opts.tokenVerifier;

		fastify.decorate(
			"verifyBearerToken",
			async function verifyBearerToken(request: FastifyRequest) {
				const header = request.headers.authorization;

				if (!header?.startsWith("Bearer ")) {
					request.log.warn(
						{ reason: "missing-or-malformed-header" },
						"auth rejected"
					);
					throw unauthorized();
				}

				const token = header.slice("Bearer ".length);

				try {
					const claims = await verifier.verifyToken(token);
					request.authContext = getContext(claims);
				} catch (err) {
					// reason stays internal in logs and not returned in the response
					request.log.warn({ err }, "auth rejected");
					throw unauthorized();
				}
			}
		);

		fastify.addHook("preHandler", async (request, _reply) => {
			// Routes are guarded by default, can only opt out by setting config : { authConfig: {public: true }}
			if (request.routeOptions.config?.authConfig?.public) return;
			// @fastify/swagger-ui registers its own routes, so they can't carry config.public
			if (request.url.startsWith("/docs")) return;

			await fastify.verifyBearerToken(request);

			const requiredScopes =
				request.routeOptions.config.authConfig?.requiredScopes;
			const authContext = request.authContext;
			if (
				requiredScopes &&
				(!authContext || !getAuthScopes(authContext, requiredScopes))
			) {
				request.log.warn(
					{ "required: ": requiredScopes, given: request.authContext?.scope },
					"Caller does not have the required scopes"
				);
				throw unauthorized();
			}
		});
	},
	{ name: "auth" }
);
