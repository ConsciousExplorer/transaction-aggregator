import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import { buildCategoryResponse } from "./categories.mappers.ts";
import { categoryListResponseSchema } from "./categories.schemas.ts";

export default async function registerCategoriesRoute(
	fastify: FastifyInstance,
	options: { categoryRepository: CategoryRepository }
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		schema: {
			tags: ["categories"],
			hide: false,
			response: {
				200: categoryListResponseSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await options.categoryRepository.getCategories();

			const data = [];
			for (const row of rows) {
				data.push(buildCategoryResponse(row));
			}

			return reply.send({
				data: data,
				links: { self: request.url },
				meta: { count: data.length }
			});
		}
	});
}
