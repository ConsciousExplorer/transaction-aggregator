import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import { getCategories } from "#src/integrations/database/repositories/category-repository.ts";
import { notFound } from "#src/problems.ts";

/**
 * A basic info route
 */
export default async (fastify: FastifyInstance, opts: { database: Pool }) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			hide: false,
			response: {
				200: z.object({
					data: z.string().array()
				})
			}
		},
		handler: async (_request, reply) => {
			const result = await getCategories(opts.database);

			if (!result) throw notFound();

			return reply.send({
				data: result.map((category) => category.name)
			});
		}
	});
};
