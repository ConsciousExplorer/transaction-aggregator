import { z } from "zod";
import { cardTransactionSchema } from "./card.ts";
import { debitOrderTransactionSchema } from "./debit_order.ts";
import { eftTransactionSchema } from "./eft.ts";
import { internalTransferTransactionSchema } from "./internal_transfer.ts";
import { loanTransactionSchema } from "./loan.ts";

export const directionSchema = z.enum(["debit", "credit"]);

export const transactionStatusSchema = z.enum([
	"completed",
	"pending",
	"reversed",
	"failed"
]);

export const domainTransactionSchema = z.union([
	cardTransactionSchema,
	debitOrderTransactionSchema,
	eftTransactionSchema,
	internalTransferTransactionSchema,
	loanTransactionSchema
]);

export const CANONICAL_TRANSACTION_TYPES = [
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
] as const;

export const transactionTypeSchema = z.enum(CANONICAL_TRANSACTION_TYPES);

export const canonicalTransactionSchema = z.object({
	// Used for user transaction identification
	userId: z.uuid(),
	// The customer account the transaction occurred on — a user can hold
	// several accounts.
	accountId: z.uuid(),

	// Which of the 5 origins this transaction came from - used for idempotency
	transactionType: transactionTypeSchema,
	externalId: z.string(),
	// Full ISO datetime: normalisers emit `new Date(ts).toISOString()`, and
	// date-only would collapse the deduplicate key (transactionType, externalId, occurredAt)
	// to day granularity.
	occurredAt: z.iso.datetime(),

	// Top level financial information
	direction: directionSchema,
	// Stored for every status; the API excludes non-completed rows from aggregates
	status: transactionStatusSchema,
	currency: z.string(),
	amountMinor: z.number(),

	longDescription: z.string().nullable(),
	// Who we paid / who paid us
	shortDescription: z.string().nullable(),

	metadata: z.record(z.string(), z.unknown())
});

export const categorisedTransactionSchema = canonicalTransactionSchema.extend({
	categoryId: z.number(),
	ruleVersion: z.number(),
	rulePriority: z.number().nullable()
});

export type TransactionType = z.infer<typeof transactionTypeSchema>;

export type DomainTransactionSchema = z.infer<typeof domainTransactionSchema>;

export type CanonicalTransactionSchema = z.infer<
	typeof canonicalTransactionSchema
>;
export type CategorisedTransactionSchema = z.infer<
	typeof categorisedTransactionSchema
>;
