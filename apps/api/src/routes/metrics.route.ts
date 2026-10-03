import type { FastifyInstance } from "fastify";
import { registry } from "#src/telemetry/metrics.ts";

/**
 * /metrics route for Prometheus to scrape.
 * The route is public and does not require authentication.
 */
export default async (fastify: FastifyInstance) => {
	fastify.route({
		method: "GET",
		config: { authConfig: { public: true } },
		url: "/metrics",
		schema: { hide: true },
		handler: async (_request, reply) => {
			reply.header("Content-Type", registry.contentType);
			return reply.send(await registry.metrics());
		}
	});
};
