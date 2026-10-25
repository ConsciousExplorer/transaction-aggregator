import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";
import { buildUserCategoryResponse } from "../categories/categories.mappers.ts";
import { userCategoryListResponseSchema } from "../categories/categories.schemas.ts";

export default async function registerListCategoryOverridesRoute(
	fastify: FastifyInstance,
	options: { categoryRepository: Pick<CategoryRepository, "getUserCategories"> }
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
			tags: ["user categories"],
			hide: false,
			params: z.object({ userId: z.uuid() }),
			response: {
				200: userCategoryListResponseSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await options.categoryRepository.getUserCategories(
				request.params.userId
			);

			const overridden = [];
			for (const row of rows) {
				if (row.toCategoryId !== null) {
					overridden.push(buildUserCategoryResponse(row));
				}
			}

			return reply.send({
				data: overridden,
				links: { self: request.url },
				meta: { count: overridden.length }
			});
		}
	});
}
