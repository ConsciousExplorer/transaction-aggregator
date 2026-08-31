import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import z from "zod";
import { notFound } from "#src/problems.ts";
import type { Repositories } from "#src/server.ts";

const categorySchema = z.object({
	category: z.string().describe("Category names"),
	label: z.string()
});

/**
 * A basic info route
 */
export default async (
	fastify: FastifyInstance,
	opts: { database: Pool; repositories: Repositories }
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array()
				})
			}
		},
		handler: async (_request, reply) => {
			const result = await opts.repositories.categories.getCategories(
				opts.database
			);

			if (!result) throw notFound();

			return reply.send({
				data: result.map((item) => ({
					category: item.category,
					label: item.label
				}))
			});
		}
	});
};
