import { context } from "@opentelemetry/api";
import { getRPCMetadata, RPCType } from "@opentelemetry/core";
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
		fastify.addHook("onRequest", async (request) => {
			httpRequestsInFlight.inc();

			// The auto-instrumentation has no Fastify support, so its http span only
			// knows "GET". Handing it the route pattern names the span
			// "GET /v1/users/:userId/transactions" and sets http.route. With tracing
			// disabled there is no metadata, and this does nothing. A 404 matched no
			// route, so its span keeps the bare method name.
			const rpcMetadata = getRPCMetadata(context.active());
			const route = request.routeOptions.url;
			if (rpcMetadata?.type === RPCType.HTTP && route) {
				rpcMetadata.route = route;
			}
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
