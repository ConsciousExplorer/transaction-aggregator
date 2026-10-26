import { z } from "zod";
import { cardTransactionSchema } from "./card.ts";
import { debitOrderTransactionSchema } from "./debit_order.ts";
import { eftTransactionSchema } from "./eft.ts";
import { internalTransferTransactionSchema } from "./internal_transfer.ts";
import { loanTransactionSchema } from "./loan.ts";

export const CANONICAL_TRANSACTION_TYPES = [
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
] as const;

export const transactionTypeSchema = z.enum(CANONICAL_TRANSACTION_TYPES);

// Whether money came into the account (credit) or left it (debit), as a bank
// statement shows it. ISO 20022 calls this the credit/debit indicator.
export const creditDebitIndicatorSchema = z.enum(["credit", "debit"]);

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

export const canonicalTransactionSchema = z.object({
	userId: z.uuid(),
	// A user can hold several accounts
	accountId: z.uuid(),

	transactionType: transactionTypeSchema,
	externalId: z.string().max(255),
	// Full ISO datetime: date-only would collapse the deduplicate key
	// (transactionType, externalId, occurredAt) to day granularity
	occurredAt: z.iso
		.datetime()
		.refine(
			(value) => Date.parse(value) <= Date.now() + 24 * 60 * 60 * 1000,
			"must not be more than a day in the future"
		),

	creditDebitIndicator: creditDebitIndicatorSchema,
	// Stored for every status; the API excludes non-completed rows from aggregates
	status: transactionStatusSchema,
	currency: z.string().regex(/^[A-Z]{3}$/),
	amountMinor: z.number(),

	longDescription: z.string().max(1000).nullable(),
	// Who we paid / who paid us
	shortDescription: z.string().max(255).nullable(),

	metadata: z.record(z.string(), z.unknown())
});

export const categorisedTransactionSchema = canonicalTransactionSchema.extend({
	categoryId: z.number(),
	ruleVersion: z.number(),
	rulePriority: z.number().nullable()
});

export type TransactionType = z.infer<typeof transactionTypeSchema>;

export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export type DomainTransactionSchema = z.infer<typeof domainTransactionSchema>;

export type CanonicalTransactionSchema = z.infer<
	typeof canonicalTransactionSchema
>;
export type CategorisedTransactionSchema = z.infer<
	typeof categorisedTransactionSchema
>;
