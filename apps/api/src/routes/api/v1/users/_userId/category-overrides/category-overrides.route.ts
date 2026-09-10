import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import { validationError } from "#src/errors/http-problem.ts";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { problemSchema } from "#src/schemas/common.ts";

const userParamsSchema = z.object({ userId: z.uuid() });
const paramsSchema = userParamsSchema.extend({
	categoryId: z.coerce.number().int().positive()
});
const putBodySchema = z.object({ toCategoryId: z.number().int().positive() });

// A category's identity as nested elsewhere in this file's responses.
const categoryRefSchema = z.object({
	id: z.number().int(),
	category: z.string(),
	label: z.string()
});

// Same as categoryRefSchema plus the remap's own updatedAt.
const mappedToSchema = categoryRefSchema.extend({
	updatedAt: z.iso.datetime()
});

const userCategorySchema = z.object({
	id: z.number().int(),
	category: z.string(),
	label: z.string(),
	mappedTo: mappedToSchema.optional()
});

type UserCategoryRow = Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
>[number];

export function toUserCategory(row: UserCategoryRow) {
	return {
		id: row.categoryId,
		category: row.category,
		label: row.label,
		...(row.toCategoryId !== null &&
		row.toCategory !== null &&
		row.toLabel !== null &&
		row.updatedAt !== null
			? {
					mappedTo: {
						id: row.toCategoryId,
						category: row.toCategory,
						label: row.toLabel,
						updatedAt: new Date(row.updatedAt).toISOString()
					}
				}
			: {})
	};
}

export default async (
	fastify: FastifyInstance,
	opts: {
		categoryRepository: CategoryRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: userParamsSchema,
			response: {
				200: z.object({
					overrides: userCategorySchema.array()
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await opts.categoryRepository.getUserCategories(
				request.params.userId
			);

			const overridden = rows
				.filter((row) => row.toCategoryId !== null)
				.map(toUserCategory);

			return reply.send({ overrides: overridden });
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:categoryId",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: paramsSchema,
			body: putBodySchema,
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

			const override = await opts.categoryRepository.updateUserCategory(
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

			// Same shape as GET "" / GET /overrides: the just-written category,
			// with its new mappedTo.
			return reply.send({
				id: override.fromCategoryId,
				category: override.category,
				label: override.label,
				mappedTo: {
					id: override.toCategoryId,
					category: override.toCategory,
					label: override.toLabel,
					updatedAt: new Date(override.updatedAt).toISOString()
				}
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:categoryId",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: paramsSchema,
			response: {
				204: z.undefined(),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, categoryId } = request.params;

			await opts.categoryRepository.archiveUserCategory(userId, categoryId);

			return reply.code(204).send(undefined);
		}
	});
};
