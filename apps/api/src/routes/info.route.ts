import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";

const infoCheckResponseSchema = z.object({
	status: z.literal("ok")
});
/**
 * A basic health check route
 */
export default async (fastify: FastifyInstance) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/info",
		schema: {
			hide: true,
			response: {
				200: infoCheckResponseSchema
			}
		},
		handler: async (_request, reply) => {
			reply.send({
				status: "ok"
			});
		}
	});
};
