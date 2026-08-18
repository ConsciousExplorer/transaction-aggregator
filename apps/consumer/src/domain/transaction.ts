import { z } from "zod";

export const sourceSchema = z.enum([
	"card",
	"loan",
	"debit_order",
	"eft",
	"internal_transfer"
]);

export const directionSchema = z.enum(["debit", "credit"]);

export const canonicalTransactionSchema = z.object({
	// Used for user transaction identification
	userId: z.uuid(),

	// External source name and string - used for idempotency
	source: z.string(),
	externalId: z.string(),
	occuredAt: z.iso.date(),

	// Top level financation information
	postedAt: z.iso.date().nullable(),
	direction: directionSchema,
	currency: z.string(),
	amountMinor: z.number(), // Always use cents

	// Assuming we will always pay a merchant or make internal transfers
	description: z.string().nullable(),
	merchantName: z.string().nullable(),
	mcc: z
		.string()
		.nullable() // Use ISO 18245:2023
		.transform((value) => (value === "" ? null : value)),
	metadata: z.record(z.string(), z.unknown())
});

export const categorizedTransactionSchema = canonicalTransactionSchema.extend({
	categoryId: z.number(),
	ruleVersion: z.number(),
	rulePriority: z.number().nullable()
});
