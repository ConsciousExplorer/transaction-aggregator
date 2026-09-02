import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { notFound } from "#src/problems.ts";

const categorySchema = z.object({
	category: z.string().describe("Category names"),
	label: z.string()
});

/**
 * A basic info route
 */
export default async (
	fastify: FastifyInstance,
	// Narrowed slice of RouteOptions: this route declares it only knows about
	// the categories repository — and tests can register it with exactly this.
	opts: {
		categoryRepository: CategoryRepository;
	}
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
			const result = await opts.categoryRepository.getCategories();

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
