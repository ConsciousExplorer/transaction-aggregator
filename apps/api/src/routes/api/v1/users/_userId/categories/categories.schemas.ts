import z from "zod";
import { collectionMetaSchema, linksSchema } from "#src/schemas/common.ts";

const categoryReferenceSchema = z.object({
	categoryId: z.number().int(),
	category: z.string(),
	label: z.string()
});

const mappedToSchema = categoryReferenceSchema.extend({
	updatedAt: z.iso.datetime()
});

export const userCategorySchema = z.object({
	categoryId: z.number().int(),
	category: z.string(),
	label: z.string(),
	mappedTo: mappedToSchema.optional()
});
export type UserCategory = z.infer<typeof userCategorySchema>;

export const userCategoryListResponseSchema = z.object({
	data: userCategorySchema.array(),
	links: linksSchema,
	meta: collectionMetaSchema
});
