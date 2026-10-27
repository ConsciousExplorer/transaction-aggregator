import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { okStatusSchema } from "./checks.schemas.ts";

/** The process is up. Reachable without a token. */
export default async function registerHealthRoute(fastify: FastifyInstance) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/health",
		config: { authConfig: { public: true } },
		schema: {
			hide: true,
			response: {
				200: okStatusSchema
			}
		},
		handler: async (_request, reply) => {
			return reply.send({ status: "ok" });
		}
	});
}
