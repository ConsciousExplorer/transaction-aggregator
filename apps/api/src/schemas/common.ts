import z from "zod";

export const problemSchema = z.object({
	type: z.string(),
	title: z.string(),
	status: z.number(),
	detail: z.string().optional(),
	errors: z.array(z.unknown()).optional(),
	trace_id: z.string().optional(),
	retry_after: z.number().optional()
});

// Every collection response is { data, links, meta }. links.self is the
// request as received; next and prev are relative links to the neighbouring
// pages, null when there is none (always null on unpaginated collections).
export const linksSchema = z.object({
	self: z.string(),
	next: z.string().nullable(),
	prev: z.string().nullable()
});

export const collectionMetaSchema = z.object({
	// Rows in data
	count: z.number().int()
});
