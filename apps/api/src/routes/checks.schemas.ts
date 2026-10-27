import z from "zod";

// What /health and /ready answer when all is well
export const okStatusSchema = z.object({
	status: z.literal("ok")
});
