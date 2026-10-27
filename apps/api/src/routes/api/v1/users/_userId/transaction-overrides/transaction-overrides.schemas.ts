import z from "zod";

export const transactionOverrideSchema = z.object({
	transactionId: z.uuid(),
	categoryId: z.number().int(),
	updatedAt: z.iso.datetime()
});
