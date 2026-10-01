import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import z from "zod";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import {
	collectionMetaSchema,
	linksSchema,
	problemSchema
} from "#src/schemas/common.ts";
import { toUserCategory } from "../category-overrides/category-overrides.route.ts";

const userParamsSchema = z.object({ userId: z.uuid() });

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

export default async (
	fastify: FastifyInstance,
	opts: {
		categoryRepository: CategoryRepository;
	}
) => {
	fastify.withTypeProvider<ZodTypeProvider>().route({
		method: "GET",
		config: {
			authConfig: {
				requiredScope: ["tx:read"]
			}
		},
		url: "",
		schema: {
			tags: ["user categories"],
			hide: false,
			params: userParamsSchema,
			response: {
				200: z.object({
					data: userCategorySchema.array(),
					links: linksSchema,
					meta: collectionMetaSchema
				}),
				400: problemSchema,
				500: problemSchema
			}
		},
		handler: async (request, reply) => {
			const rows = await opts.categoryRepository.getUserCategories(
				request.params.userId
			);

			const data = rows.map(toUserCategory);

			return reply.send({
				data,
				links: { self: request.url },
				meta: { count: data.length }
			});
		}
	});
};
