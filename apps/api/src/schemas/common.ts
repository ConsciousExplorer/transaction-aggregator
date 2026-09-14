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
