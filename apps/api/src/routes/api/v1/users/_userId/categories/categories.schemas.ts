import z from "zod";
import { collectionMetaSchema, linksSchema } from "#src/schemas/common.ts";

const categoryReferenceSchema = z.object({
	id: z.number().int(),
	category: z.string(),
	label: z.string()
});

const mappedToSchema = categoryReferenceSchema.extend({
	updatedAt: z.iso.datetime()
});

export const userCategorySchema = z.object({
	id: z.number().int(),
	category: z.string(),
	label: z.string(),
	mappedTo: mappedToSchema.optional()
});

export const userCategoryListResponseSchema = z.object({
	data: userCategorySchema.array(),
	links: linksSchema,
	meta: collectionMetaSchema
});
