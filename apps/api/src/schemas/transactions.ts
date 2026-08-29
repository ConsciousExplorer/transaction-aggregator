import z from "zod";
import { sourceSchema } from "./common.js";

export const listQuerySchema = z.object({
	from: z.iso.datetime().optional(), // route defaults: to=now, from=to−30d (parent §7)
	to: z.iso.datetime().optional(),
	source: sourceSchema.optional(),
	categoryId: z.coerce.number().int().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.coerce.number().int().optional(),
	amountMax: z.coerce.number().int().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const transactionListItemSchema = z.object({
	// EXACTLY idx_tx_user_read's key + INCLUDE columns → the list query stays index-only
	id: z.uuid(),
	occurredAt: z.iso.datetime(),
	source: z.union([z.string(), sourceSchema.optional()]),
	direction: z.union([z.string(), z.enum(["debit", "credit"])]),
	amountMinor: z.number().int(),
	currency: z.string(),
	categoryId: z.number().int(),
	merchantName: z.string().nullable()
});

export const transactionDetailSchema = transactionListItemSchema.extend({
	accountId: z.uuid(), // added 2026-08-23 with the accountId column
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
	data: z.array(transactionListItemSchema),
	nextCursor: z.string().nullable()
});
