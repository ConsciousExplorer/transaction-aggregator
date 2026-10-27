import { context } from "@opentelemetry/api";
import { getRPCMetadata, RPCType } from "@opentelemetry/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import {
	httpRequestDurationSeconds,
	httpRequestsInFlight
} from "#src/telemetry/metrics.ts";

// The status nginx logs for a request whose client closed the connection
// before the response was sent. No server sends it; it labels those requests.
export const CLIENT_CLOSED_REQUEST = 499;

/**
 * Runs once a request has ended: its response was sent, or its client went
 * away first. The response's close event fires exactly once either way.
 * onResponse runs only for a response that was sent, so an aborted request
 * would leave the gauge one higher for good, and the histogram would leave out
 * exactly the requests slow enough to be abandoned.
 */
function recordRequestEnd(request: FastifyRequest, reply: FastifyReply) {
	httpRequestsInFlight.dec();
	httpRequestDurationSeconds.observe(
		{
			method: request.method,
			// 404s match no route, so they have no pattern; one shared value keeps them bounded
			route: request.routeOptions.url ?? "unmatched",
			status_code: reply.raw.writableEnded
				? reply.statusCode
				: CLIENT_CLOSED_REQUEST
		},
		reply.elapsedTime / 1000
	);
}

// RED metrics (rate, errors, duration) for every route. The route label is the
// pattern (/v1/users/:userId/transactions), never the raw URL: one series per
// user id would blow up Prometheus's storage.
export default fastifyPlugin(
	async (fastify) => {
		fastify.addHook("onRequest", async (request, reply) => {
			httpRequestsInFlight.inc();
			reply.raw.once("close", () => recordRequestEnd(request, reply));

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
	},
	{ name: "http-metrics" }
);
