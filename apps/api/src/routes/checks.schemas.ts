import z from "zod";

export const healthCheckResponseSchema = z.object({
	status: z.literal("ok")
});

export const readyCheckResponseSchema = z.object({
	status: z.literal("ok")
});
