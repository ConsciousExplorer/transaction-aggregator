import type { FastifyInstance } from "fastify";
import { registry } from "#src/telemetry/metrics.ts";

/** /metrics route for Prometheus to scrape. Reachable without a token. */
export default async function registerMetricsRoute(fastify: FastifyInstance) {
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
}
