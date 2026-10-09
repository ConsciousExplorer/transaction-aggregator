import z from "zod";
import {
	amountSchema,
	collectionMetaSchema,
	cursorDirectionSchema,
	linksSchema
} from "./common.ts";

export const transactionTypeSchema = z.enum([
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
]);

// Every status is listed; only completed counts toward summary aggregates
export const transactionStatusSchema = z.enum([
	"completed",
	"pending",
	"reversed",
	"failed"
]);

// -occurredAt is newest first, occurredAt oldest first
export const transactionSortSchema = z.enum(["-occurredAt", "occurredAt"]);
export type TransactionSort = z.infer<typeof transactionSortSchema>;

// What a list cursor carries: the boundary row's keyset and which way to read
// from it. occurredAt is exact to the microsecond, because rows can differ only
// in microseconds and a millisecond bound would skip or repeat them.
export const transactionCursorSchema = z.object({
	occurredAt: z.iso.datetime({ precision: 6 }),
	transactionId: z.uuid(),
	direction: cursorDirectionSchema
});
export type TransactionCursor = z.infer<typeof transactionCursorSchema>;

export const transactionItemSchema = z.object({
	transactionId: z.uuid(),
	occurredAt: z.iso.datetime(),
	transactionType: z.union([z.string(), transactionTypeSchema.optional()]),
	direction: z.union([z.string(), z.enum(["debit", "credit"])]),
	status: transactionStatusSchema,
	amount: amountSchema.describe(
		"direction says whether this money went out (debit) or came in (credit)"
	),
	category: z.string(),
	shortDescription: z.string().nullable()
});

export const listResponseSchema = z.object({
	data: z.array(transactionItemSchema),
	// links.next and links.prev are the only way to page: each carries the
	// cursor and every filter, so a client never builds a page request itself.
	links: linksSchema,
	// No total: counting the whole window on every request is the full scan
	// keyset pagination avoids.
	meta: collectionMetaSchema.extend({
		limit: z.number().int(),
		sort: transactionSortSchema,
		fromDateTime: z.iso.datetime(),
		toDateTime: z.iso.datetime()
	})
});

const cardFundingSourceSchema = z.object({
	transactionType: z.literal("card"),
	cardLast4: z.string().length(4),
	cardNetwork: z.string(),
	mcc: z.string().length(4).nullable(),
	merchantName: z.string().nullable(),
	posEntryMode: z.string().nullable(),
	authCode: z.string().nullable()
});

const loanFundingSourceSchema = z.object({
	transactionType: z.literal("loan"),
	loanAccountId: z.uuid(),
	loanType: z.string(),
	operation: z.enum(["repayment", "disbursement"]),
	principal: amountSchema.nullable(),
	interest: amountSchema.nullable()
});

const eftFundingSourceSchema = z.object({
	transactionType: z.literal("eft"),
	beneficiaryName: z.string(),
	beneficiaryAccountLast4: z.string().nullable(),
	beneficiaryBank: z.string(),
	branchCode: z.string().nullable(),
	reference: z.string().nullable(),
	// Rows ingested before the consumer stored clearingType have no such key
	clearingType: z.string().nullable().default(null)
});

const debitOrderFundingSourceSchema = z.object({
	transactionType: z.literal("debit_order"),
	mandateId: z.string(),
	creditorName: z.string(),
	collectionType: z.string().nullable(),
	frequency: z.string().nullable()
});

const internalTransferFundingSourceSchema = z.object({
	transactionType: z.literal("internal_transfer"),
	fromAccountId: z.uuid(),
	toAccountId: z.uuid(),
	fromAccountType: z.string(),
	toAccountType: z.string()
});

export const fundingSourceSchema = z.discriminatedUnion("transactionType", [
	cardFundingSourceSchema,
	loanFundingSourceSchema,
	eftFundingSourceSchema,
	debitOrderFundingSourceSchema,
	internalTransferFundingSourceSchema
]);

export type FundingSource = z.infer<typeof fundingSourceSchema>;
export function mapFundingSource(
	transactionType: z.infer<typeof transactionTypeSchema>,
	metadata: unknown,
	currency: string
): FundingSource {
	const raw = metadata as Record<string, unknown>;

	if (transactionType === "loan") {
		const { principalAmount, interestAmount, ...rest } = raw;
		return fundingSourceSchema.parse({
			transactionType,
			...rest,
			principal:
				typeof principalAmount === "number"
					? { amountMinor: principalAmount, currency }
					: null,
			interest:
				typeof interestAmount === "number"
					? { amountMinor: interestAmount, currency }
					: null
		});
	}

	return fundingSourceSchema.parse({ transactionType, ...raw });
}

export const transactionDetailSchema = z.object({
	transactionId: z.uuid(),
	accountId: z.uuid(),
	externalId: z.string(),
	occurredAt: z.iso.datetime(),
	direction: z.enum(["debit", "credit"]),
	amount: amountSchema,
	status: transactionStatusSchema,
	longDescription: z.string().nullable(),
	shortDescription: z.string().nullable(),
	category: z.string(),
	fundingSource: fundingSourceSchema // Discriminated Union detail schema
});
