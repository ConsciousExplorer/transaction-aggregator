import { fastifyPlugin } from "fastify-plugin";

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
					// request.id is the W3C trace id; a 500 problem carries the same id
					trace_id: request.id
				},
				"audit"
			);
		});
	},
	{ name: "audit" }
);
