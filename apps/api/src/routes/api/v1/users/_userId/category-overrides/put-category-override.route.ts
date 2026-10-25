import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { validationError } from "#src/errors/http-problem.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import {
	categoryIdParamSchema,
	categoryIdSchema,
	problemSchema
} from "#src/schemas/common.ts";
import { userCategorySchema } from "../categories/categories.schemas.ts";
import { buildRemappedUserCategory } from "./category-overrides.mappers.ts";

export default async function registerPutCategoryOverrideRoute(
	fastify: FastifyInstance,
	options: {
		categoryRepository: Pick<CategoryRepository, "updateUserCategory">;
	}
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:categoryId",
		config: {
			authConfig: {
				requiredScope: ["tx:write"]
			}
		},
		schema: {
			tags: ["user categories"],
			hide: false,
			params: z.object({
				userId: z.uuid(),
				categoryId: categoryIdParamSchema
			}),
			body: z.object({ toCategoryId: categoryIdSchema }),
			response: {
				200: userCategorySchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, categoryId } = request.params;
			const { toCategoryId } = request.body;

			if (categoryId === toCategoryId)
				throw validationError([
					{
						path: ["toCategoryId"],
						message: "toCategoryId must differ from categoryId"
					}
				]);

			const override = await options.categoryRepository.updateUserCategory(
				userId,
				categoryId,
				toCategoryId
			);
			if (!override)
				throw validationError([
					{
						path: ["categoryId", "toCategoryId"],
						message: "unknown categoryId or toCategoryId"
					}
				]);

			return reply.send(buildRemappedUserCategory(override));
		}
	});
}
