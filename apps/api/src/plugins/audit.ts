import { fastifyPlugin } from "fastify-plugin";

// One info line per authenticated request, written after the response: the
// compensating control for the coarse tx:read scope (D20), keyed on the
// calling app (azp, D52). A hook, so no route can leave it out. A request whose
// token never verified (401) has no caller to name; auth logs it as
// "auth rejected". Public routes have no caller either.
export default fastifyPlugin(
	async (fastify) => {
		fastify.addHook("onResponse", async (request, reply) => {
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
					status: reply.statusCode,
					// The request id until OTel tracing lands; a 500 problem carries the same id
					trace_id: request.id
				},
				"audit"
			);
		});
	},
	{ name: "audit" }
);
