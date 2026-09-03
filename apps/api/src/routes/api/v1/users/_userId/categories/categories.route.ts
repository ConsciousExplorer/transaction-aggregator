import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { categorySchema } from "#src/schemas/categories.ts";

export default async (
	fastify: FastifyInstance,
	opts: {
		categoryRepository: CategoryRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		url: "/:categoryId/override",
		schema: {
			tags: ["user categories"],
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array()
				})
			}
		},
		handler: async (_request, reply) => {
			const result = await opts.categoryRepository.getCategories();

			return reply.send({
				data: []
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "PUT",
		url: "/:categoryId/override",
		schema: {
			tags: ["user categories"],
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array()
				})
			}
		},
		handler: async (_request, reply) => {
			const result = await opts.categoryRepository.getCategories();

			return reply.send({
				data: []
			});
		}
	});

	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "DELETE",
		url: "/:categoryId/override",
		schema: {
			tags: ["user categories"],
			hide: false,
			response: {
				200: z.object({
					data: categorySchema.array()
				})
			}
		},
		handler: async (_request, reply) => {
			// const result = await opts.categoryRepository.getCategories();

			return reply.send({
				data: []
			});
		}
	});
};
