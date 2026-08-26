import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { config } from "#src/runtime.ts";

const infoCheckResponseSchema = z.object({
	title: z.string(),
	version: z.string(),
	author: z.string(),
	description: z.string(),
	dependencies: z.record(z.string(), z.string())
});

/**
 * A basic info route
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
				title: config.info.title,
				version: config.info.version,
				author: config.info.auhor,
				description: config.info.description,
				dependencies: config.info.dependencies
			});
		}
	});
};
