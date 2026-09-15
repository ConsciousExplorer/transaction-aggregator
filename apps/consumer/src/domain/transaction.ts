import { z } from "zod";

export const directionSchema = z.enum(["debit", "credit"]);

export const CANONICAL_SOURCES = [
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
] as const;
export const sourceSchema = z.enum(CANONICAL_SOURCES);

export const canonicalTransactionSchema = z.object({
	// Used for user transaction identification
	userId: z.uuid(),
	// The customer account the transaction occurred on — a user can hold
	// several accounts.
	accountId: z.uuid(),

	// External source name - used for idempotency
	source: sourceSchema,
	externalId: z.string(),
	// Full ISO datetime: normalisers emit `new Date(ts).toISOString()`, and
	// date-only would collapse the deduplicate key (source, externalId, occurredAt)
	// to day granularity.
	occurredAt: z.iso.datetime(),

	// Top level financial information
	postedAt: z.iso.datetime().nullable(),
	direction: directionSchema,
	currency: z.string(),
	amountMinor: z.number(), 

	longDescription: z.string().nullable(),
	// Who we paid / who paid us
	shortDescription: z.string().nullable(),
	// Used pre-insert by the tier-1 categorization matcher only — not a DB
	// column; card is the only source that carries one, and it also lands in
	// card's own metadata for the API's per-source detail union.
	mcc: z
		.string()
		.nullable() // Use ISO 18245:2023
		.transform((value) => (value === "" ? null : value)),
	metadata: z.record(z.string(), z.unknown())
});

export const categorisedTransactionSchema = canonicalTransactionSchema.extend({
	categoryId: z.number(),
	ruleVersion: z.number(),
	rulePriority: z.number().nullable()
});
