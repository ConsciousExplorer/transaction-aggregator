import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { validationError } from "#src/problems.ts";
import { problemSchema } from "#src/schemas/common.ts";

// D34: categoryId is the wire identifier (clients hold the taxonomy from
// GET /categories); slugs/labels stay display-only. No slug resolution here —
// unknown ids trip the FK constraints and surface as 400s.
const userParamsSchema = z.object({ userId: z.uuid() });
const paramsSchema = userParamsSchema.extend({
	categoryId: z.coerce.number().int().positive()
});
const putBodySchema = z.object({ toCategoryId: z.number().int().positive() });
const putResponseSchema = z.object({
	categoryId: z.number().int(),
	toCategoryId: z.number().int(),
	updatedAt: z.iso.datetime()
});

// The full taxonomy through this user's eyes: toCategoryId names the active
// remap target, null when the category is not overridden.
const userCategorySchema = z.object({
	categoryId: z.number().int(),
	category: z.string(),
	label: z.string(),
	toCategoryId: z.number().int().nullable()
});

const overrideItemSchema = z.object({
	categoryId: z.number().int(),
	toCategoryId: z.number().int(),
	updatedAt: z.iso.datetime()
});

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
					data: userCategorySchema.array()
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await opts.categoryRepository.getUserCategories(
				request.params.userId
			);

			return reply.send({
				data: rows.map((row) => ({
					categoryId: row.categoryId,
					category: row.category,
					label: row.label,
					toCategoryId: row.toCategoryId
				}))
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/overrides",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: userParamsSchema,
			response: {
				200: z.object({
					data: overrideItemSchema.array()
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await opts.categoryRepository.getUserCategories(
				request.params.userId
			);

			const overridden = [];
			for (const row of rows) {
				if (row.toCategoryId === null || row.updatedAt === null) continue;
				overridden.push({
					categoryId: row.categoryId,
					toCategoryId: row.toCategoryId,
					updatedAt: new Date(row.updatedAt).toISOString()
				});
			}

			return reply.send({ data: overridden });
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:categoryId/override",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: paramsSchema,
			body: putBodySchema,
			response: {
				200: putResponseSchema,
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, categoryId } = request.params;
			const { toCategoryId } = request.body;

			// Free check here; the DB CHECK (from ≠ to) backstops it.
			if (categoryId === toCategoryId)
				throw validationError([
					{
						path: ["toCategoryId"],
						message: "toCategoryId must differ from categoryId"
					}
				]);

			// D34: undefined = FK violation = at least one id is not in the taxonomy.
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

			return reply.send({
				categoryId: override.fromCategoryId,
				toCategoryId: override.toCategoryId,
				updatedAt: new Date(override.updatedAt).toISOString()
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:categoryId/override",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: paramsSchema,
			// Once a response map exists, reply.code() is narrowed to the
			// declared statuses — the bodyless 204 needs an explicit entry.
			response: {
				204: z.undefined(),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const { userId, categoryId } = request.params;

			// Idempotent: unknown id or nothing active archives zero rows — 204.
			await opts.categoryRepository.archiveUserCategory(userId, categoryId);

			return reply.code(204).send(undefined);
		}
	});
};
