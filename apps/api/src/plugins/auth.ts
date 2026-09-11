import type { FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import {
	type AuthConfig,
	type AuthContext,
	createTokenVerifier,
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
		public?: boolean;
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
			// routeOptions.config is undefined for routes that don't set
			if (request.routeOptions.config?.public) return;
			await fastify.verifyBearerToken(request);
		});
	},
	{ name: "auth" }
);
