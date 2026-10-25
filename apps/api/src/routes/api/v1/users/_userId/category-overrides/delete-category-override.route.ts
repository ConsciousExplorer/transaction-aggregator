import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { categoryIdParamSchema, problemSchema } from "#src/schemas/common.ts";

export default async function registerDeleteCategoryOverrideRoute(
	fastify: FastifyInstance,
	options: {
		categoryRepository: Pick<CategoryRepository, "archiveUserCategory">;
	}
) {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
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
			response: {
				204: z.undefined(),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, categoryId } = request.params;

			await options.categoryRepository.archiveUserCategory(userId, categoryId);

			return reply.code(204).send(undefined);
		}
	});
}
