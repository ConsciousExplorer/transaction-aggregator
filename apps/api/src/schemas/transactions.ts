import z from "zod";

export const sourceSchema = z.enum([
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
]);

export const listQuerySchema = z.object({
	from: z.iso.datetime().optional(),
	to: z.iso.datetime().optional(),
	source: sourceSchema.optional(),
	categoryId: z.coerce.number().int().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.coerce.number().int().optional(),
	amountMax: z.coerce.number().int().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const transactionItemSchema = z.object({
	id: z.uuid(),
	occurredAt: z.iso.datetime(),
	source: z.union([z.string(), sourceSchema.optional()]),
	direction: z.union([z.string(), z.enum(["debit", "credit"])]),
	amountMinor: z.number().int(),
	currency: z.string(),
	category: z.string(),
	merchantName: z.string().nullable()
});

export const transactionDetailSchema = transactionItemSchema.extend({
	accountId: z.uuid(),
	externalId: z.string(),
	postedAt: z.iso.datetime().nullable(),
	description: z.string().nullable(),
	mcc: z.string().nullable(),
	ruleVersion: z.number().int(),
	rulePriority: z.number().int().nullable(),
	ingestedAt: z.iso.datetime(),
	metadata: z.record(z.string(), z.unknown())
});

export const listResponseSchema = z.object({
	data: z.array(transactionItemSchema),
	nextCursor: z.string().nullable()
});
