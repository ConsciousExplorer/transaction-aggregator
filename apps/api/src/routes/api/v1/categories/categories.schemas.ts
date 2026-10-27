import z from "zod";
import { collectionMetaSchema, linksSchema } from "#src/schemas/common.ts";

const categorySchema = z.object({
	categoryId: z.number().int(),
	category: z.string().describe("Category names"),
	label: z.string()
});

export const categoryListResponseSchema = z.object({
	data: categorySchema.array(),
	links: linksSchema,
	meta: collectionMetaSchema
});
