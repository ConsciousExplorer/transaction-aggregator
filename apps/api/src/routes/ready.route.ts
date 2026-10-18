import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import { readyCheckResponseSchema } from "./checks.schemas.ts";

/** The process can reach the database. Reachable without a token. */
export default async function registerReadyRoute(
	fastify: FastifyInstance,
	options: { database: Pool }
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/ready",
		config: { authConfig: { public: true } },
		schema: {
			hide: true,
			response: {
				200: readyCheckResponseSchema,
				503: z.object({ status: z.literal("unavailable") })
			}
		},
		handler: async (request, reply) => {
			try {
				await options.database.query("SELECT 1");
			} catch (error) {
				request.log.warn({ err: error }, "Readiness check failed: database");
				return reply.code(503).send({ status: "unavailable" });
			}

			return reply.send({ status: "ok" });
		}
	});
}
