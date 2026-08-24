import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import z from "zod";

const healthCheckResponseSchema = z.object({
	status: z.literal("ok")
});
/**
 * A basic health check route
 */
export default async (
	fastify: FastifyInstance,
	_opts: FastifyPluginOptions
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/health",
		schema: {
			hide: true,
			response: {
				200: healthCheckResponseSchema
			}
		},
		handler: async (_request, reply) => {
			reply.send({
				status: "ok"
			});
		}
	});
};
