import { fastifyPlugin } from "fastify-plugin";
import {
	httpRequestDurationSeconds,
	httpRequestsInFlight
} from "#src/telemetry/metrics.ts";

// RED metrics for every route (SPEC §7). The route label is the pattern
// (/v1/users/:userId/transactions), never the raw URL: one series per user id
// would blow up Prometheus's storage.
export default fastifyPlugin(
	async (fastify) => {
		fastify.addHook("onRequest", async () => {
			httpRequestsInFlight.inc();
		});

		fastify.addHook("onResponse", async (request, reply) => {
			httpRequestsInFlight.dec();
			httpRequestDurationSeconds.observe(
				{
					method: request.method,
					// 404s match no route, so they have no pattern; one shared value keeps them bounded
					route: request.routeOptions.url ?? "unmatched",
					status_code: reply.statusCode
				},
				reply.elapsedTime / 1000
			);
		});
	},
	{ name: "http-metrics" }
);
