import z from "zod";
import {
	amountSchema,
	collectionMetaSchema,
	linksSchema
} from "#src/schemas/common.ts";
import {
	creditDebitIndicatorSchema,
	transactionSortSchema,
	transactionStatusSchema,
	transactionTypeSchema
} from "#src/schemas/transactions.ts";

export const transactionItemSchema = z.object({
	transactionId: z.uuid(),
	occurredAt: z.iso.datetime(),
	transactionType: transactionTypeSchema,
	creditDebitIndicator: creditDebitIndicatorSchema,
	status: transactionStatusSchema,
	amount: amountSchema.describe(
		"creditDebitIndicator says whether this money went out (debit) or came in (credit)"
	),
	category: z.string(),
	shortDescription: z.string().nullable()
});

export const transactionListResponseSchema = z.object({
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
	eftFundingSourceSchema,
	debitOrderFundingSourceSchema,
	internalTransferFundingSourceSchema
]);

export const transactionDetailSchema = z.object({
	transactionId: z.uuid(),
	accountId: z.uuid(),
	externalId: z.string(),
	occurredAt: z.iso.datetime(),
	creditDebitIndicator: creditDebitIndicatorSchema,
	amount: amountSchema,
	status: transactionStatusSchema,
	longDescription: z.string().nullable(),
	shortDescription: z.string().nullable(),
	category: z.string(),
	fundingSource: fundingSourceSchema
});
