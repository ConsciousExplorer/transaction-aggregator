import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";

const readyCheckResponseSchema = z.object({
	status: z.literal("ok")
});

const notReadyResponseSchema = z.object({
	status: z.literal("unavailable")
});

const healthCheckResponseSchema = z.object({
	status: z.literal("ok")
});

/**
 * Health checks, reachable without a token.
 * /health: the process is up. /ready: the process can reach the database.
 */
export default async (
	fastify: FastifyInstance,
	opts: {
		database: Pool;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		config: { authConfig: { public: true } },
		url: "/ready",
		schema: {
			hide: true,
			response: {
				200: readyCheckResponseSchema,
				503: notReadyResponseSchema
			}
		},
		handler: async (request, reply) => {
			try {
				await opts.database.query("SELECT 1");
			} catch (err) {
				request.log.warn({ err }, "Readiness check failed: database");
				return reply.code(503).send({ status: "unavailable" });
			}

			return reply.send({ status: "ok" });
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		config: { authConfig: { public: true } },
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
