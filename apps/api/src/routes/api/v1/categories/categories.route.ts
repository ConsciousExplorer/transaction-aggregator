import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { AppCradle } from "#src/container.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { notFound } from "#src/problems.ts";
import { problemSchema } from "#src/schemas/common.ts";

const categorySchema = z.object({
	categoryId: z.number().int(),
	category: z.string().describe("Category names"),
	label: z.string()
});

/**
 * A basic info route
 */
export default async (
	fastify: FastifyInstance,
	opts: { categoryRepository: CategoryRepository }
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			tags: ["categories"],
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array()
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (_request, reply) => {
			const result = await opts.categoryRepository.getCategories();

			if (!result) throw notFound();

			return reply.send({
				data: result.map((item) => ({
					categoryId: item.categoryId,
					category: item.category,
					label: item.label
				}))
			});
		}
	});
};
