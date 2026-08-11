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
	external_id: z.string(),
	occured_at: z.iso.date(),

	// Top level financation information
	postedAt: z.iso.date(),
	direction: directionSchema,
	currency: z.string(),
	amountMinor: z.string(), // Always use cents

	// Assuming we will always pay a merchant or make internal transfers
	description: z.string().nullable(),
	merchantName: z.string().nullable(),
	mcc: z.string().nullable(), // Use ISO 18245:2023
	metadata: z.record(z.string(), z.unknown())

	// All other relevant transaction fields
});

// CREATE TABLE transactions (
//     id  UUID NOT NULL DEFAULT uuidv7(),
//     user_id UUID NOT NULL,
//     source source_type NOT NULL,
//     external_id TEXT NOT NULL,
//     occurred_at TIMESTAMPTZ NOT NULL, -- Partition key, each transaction should have a time
//     posted_at TIMESTAMPTZ,
//     direction direction_type NOT NULL,
//     amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
//     currency CHAR(3) NOT NULL,
//     description TEXT,
//     merchant_name TEXT,
//     mcc SMALLINT,
//     category_id SMALLINT NOT NULL REFERENCES categories(category_id),
//     rule_version INT NOT NULL,
//     ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//     metadata JSONB,
//     PRIMARY KEY (id, occurred_at),
//     UNIQUE (source, external_id, occurred_at)
// ) PARTITION BY RANGE (occurred_at);
