import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { notFound } from "#src/errors/http-problem.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import {
	collectionMetaSchema,
	linksSchema,
	problemSchema
} from "#src/schemas/common.ts";

const categorySchema = z.object({
	categoryId: z.number().int(),
	category: z.string().describe("Category names"),
	label: z.string()
});

export default async (
	fastify: FastifyInstance,
	opts: { categoryRepository: CategoryRepository }
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		method: "GET",
		url: "",
		schema: {
			tags: ["categories"],
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array(),
					links: linksSchema,
					meta: collectionMetaSchema
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const result = await opts.categoryRepository.getCategories();

			if (!result) throw notFound();

			const data = result.map((item) => ({
				categoryId: item.categoryId,
				category: item.category,
				label: item.label
			}));

			return reply.send({
				data,
				links: { self: request.url, next: null, prev: null },
				meta: { count: data.length }
			});
		}
	});
};
