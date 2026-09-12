import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";

const readyCheckResponseSchema = z.object({
	status: z.literal("ok")
});

const healthCheckResponseSchema = z.object({
	status: z.literal("ok")
});

/**
 * A basic health check route
 * These routes are not behind auth
 */
export default async (fastify: FastifyInstance) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		config: { public: true },
		url: "/ready",
		schema: {
			hide: true,
			response: {
				200: readyCheckResponseSchema
			}
		},
		handler: async (_request, reply) => {
			reply.send({
				status: "ok"
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		config: { public: true },
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
