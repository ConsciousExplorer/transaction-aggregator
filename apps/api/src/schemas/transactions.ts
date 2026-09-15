import z from "zod";

export const transactionTypeSchema = z.enum([
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
]);

export const amountSchema = z.object({
	amountMinor: z.number().int(),
	currency: z.string().length(3)
});

export const listQuerySchema = z.object({
	from: z.iso.datetime().optional(),
	to: z.iso.datetime().optional(),
	transactionType: transactionTypeSchema.optional(),
	categoryId: z.coerce.number().int().optional(),
	direction: z.enum(["debit", "credit"]).optional(),
	amountMin: z.coerce.number().int().optional(),
	amountMax: z.coerce.number().int().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const transactionItemSchema = z.object({
	transactionId: z.uuid(),
	occurredAt: z.iso.datetime(),
	transactionType: z.union([z.string(), transactionTypeSchema.optional()]),
	direction: z.union([z.string(), z.enum(["debit", "credit"])]),
	amountMinor: z.number().int(),
	currency: z.string(),
	category: z.string(),
	shortDescription: z.string().nullable()
});

export const listResponseSchema = z.object({
	data: z.array(transactionItemSchema),
	nextCursor: z.string().nullable()
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
	clearingType: z.string().nullable()
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
	metadata: unknown
): FundingSource {
	const raw = metadata as Record<string, unknown>;

	if (transactionType === "loan") {
		const { principalAmount, interestAmount, ...rest } = raw;
		return fundingSourceSchema.parse({
			transactionType,
			...rest,
			principal:
				typeof principalAmount === "number"
					? { amountMinor: principalAmount, currency: "ZAR" }
					: null,
			interest:
				typeof interestAmount === "number"
					? { amountMinor: interestAmount, currency: "ZAR" }
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
	// status: transactionStatusSchema, // TODO: Adding status schema with reversals for a bigger challenge later
	longDescription: z.string().nullable(),
	shortDescription: z.string().nullable(),
	category: z.string(),
	fundingSource: fundingSourceSchema // Discriminated Union detail schema
});
