import type { FastifyRequest } from "fastify";
import { fastifyPlugin } from "fastify-plugin";
import { CLIENT_CLOSED_REQUEST } from "#src/telemetry/http-metrics.ts";

/** One line per request from a known caller. A request without one is not audited. */
function writeAuditLine(request: FastifyRequest, status: number) {
	const authContext = request.authContext;
	if (!authContext) return;

	const params = request.params as { userId?: string };

	request.log.info(
		{
			event: "audit",
			client_id: authContext.clientId,
			user_id: params.userId ?? null,
			method: request.method,
			route: request.routeOptions.url,
			status,
			// request.id is the W3C trace id; a 500 problem carries the same id
			trace_id: request.id
		},
		"audit"
	);
}

export default fastifyPlugin(
	async (fastify) => {
		fastify.addHook("onResponse", async (request, reply) => {
			writeAuditLine(request, reply.statusCode);
		});

		// A client that goes away before its response skips onResponse, but the
		// handler still runs, so a write can still land. It is audited when the
		// client goes, with 499, since its outcome is not known yet.
		fastify.addHook("onRequestAbort", async (request) => {
			writeAuditLine(request, CLIENT_CLOSED_REQUEST);
		});
	},
	{ name: "audit" }
);
