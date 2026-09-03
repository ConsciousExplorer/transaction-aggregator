import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { notFound, validationError } from "#src/problems.ts";
import { problemSchema } from "#src/schemas/common.ts";

// Slugs on the wire, smallint ids internally — resolved in API
const userParamsSchema = z.object({ userId: z.uuid() });
const paramsSchema = userParamsSchema.extend({ category: z.string() });
const putBodySchema = z.object({ toCategory: z.string() });
const putResponseSchema = z.object({
	category: z.string(),
	toCategory: z.string(),
	updatedAt: z.iso.datetime()
});

const userCategorySchema = z.object({
	category: z.string(),
	label: z.string(),
	toCategory: z.string().nullable()
});

const overrideItemSchema = z.object({
	category: z.string(),
	toCategory: z.string(),
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
				})
			}
		},
		handler: async (request, reply) => {
			const rows = await opts.categoryRepository.getUserCategories(
				request.params.userId
			);

			return reply.send({
				data: rows.map((row) => ({
					category: row.category,
					label: row.label,
					toCategory: row.toCategory
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
				if (row.toCategory === null || row.updatedAt === null) continue;
				overridden.push({
					category: row.category,
					toCategory: row.toCategory,
					updatedAt: new Date(row.updatedAt).toISOString()
				});
			}

			return reply.send({ data: overridden });
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:category/override",
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
			const { userId, category } = request.params;
			const { toCategory } = request.body;

			const from = await opts.categoryRepository.resolveCategory(category);
			if (!from)
				throw validationError([
					{ path: ["category"], message: `unknown category "${category}"` }
				]);

			const to = await opts.categoryRepository.resolveCategory(toCategory);
			if (!to)
				throw validationError([
					{ path: ["toCategory"], message: `unknown category "${toCategory}"` }
				]);

			if (from.categoryId === to.categoryId)
				throw validationError([
					{
						path: ["toCategory"],
						message: "toCategory must differ from category"
					}
				]);

			const override = await opts.categoryRepository.updateUserCategory(
				userId,
				from.categoryId,
				to.categoryId
			);
			if (!override) throw notFound();

			return reply.send({
				category: from.category,
				toCategory: to.category,
				updatedAt: new Date(override.updatedAt).toISOString()
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:category/override",
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
			const { userId, category } = request.params;

			const from = await opts.categoryRepository.resolveCategory(category);
			if (!from)
				throw validationError([
					{ path: ["category"], message: `unknown category "${category}"` }
				]);

			await opts.categoryRepository.archiveUserCategory(
				userId,
				from.categoryId
			);

			return reply.code(204).send(undefined);
		}
	});
};
