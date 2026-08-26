import z from "zod";

export const sourceSchema = z.enum([
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
]);

export const listQuerySchema = z.object({
	from: z.iso.datetime().optional(), // route defaults: to=now, from=to−30d (parent §7)
	to: z.iso.datetime().optional(),
	source: sourceSchema.optional(),
	category_id: z.coerce.number().int().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amount_min: z.coerce.number().int().optional(),
	amount_max: z.coerce.number().int().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const transactionListItemSchema = z.object({
	// EXACTLY idx_tx_user_read's key + INCLUDE columns → the list query stays index-only
	id: z.uuid(),
	occurred_at: z.iso.datetime(),
	source: sourceSchema,
	direction: z.enum(["debit", "credit"]),
	amount_minor: z.number().int(),
	currency: z.string(),
	category_id: z.number().int(),
	merchant_name: z.string().nullable()
});

export const transactionDetailSchema = transactionListItemSchema.extend({
	account_id: z.uuid(), // added 2026-08-23 with the account_id column
	external_id: z.string(),
	posted_at: z.iso.datetime().nullable(),
	description: z.string().nullable(),
	mcc: z.string().nullable(),
	rule_version: z.number().int(),
	rule_priority: z.number().int().nullable(),
	ingested_at: z.iso.datetime(),
	metadata: z.record(z.string(), z.unknown())
});

export const listResponseSchema = z.object({
	data: z.array(transactionListItemSchema),
	next_cursor: z.string().nullable()
});
