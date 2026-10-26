import z from "zod";
import {
	amountSchema,
	collectionMetaSchema,
	linksSchema,
	signedAmountSchema
} from "#src/schemas/common.ts";
import { summaryIntervalSchema } from "#src/schemas/transactions.ts";

// Every amount is a money object. debit and credit totals are positive;
// netAmount is the one signed figure.
const directionTotalSchema = z.object({
	count: z.number(),
	total: amountSchema
});

const netAmountSchema = signedAmountSchema.describe(
	"credit − debit: negative when more went out than came in"
);

const summaryTotalSchema = z.object({
	transactionCount: z.number(),
	netAmount: netAmountSchema,
	debit: directionTotalSchema,
	credit: directionTotalSchema
});

const summaryItemSchema = z.object({
	group: z.object({
		category: z.string().optional(),
		month: z.string().optional(),
		week: z.string().optional(),
		day: z.string().optional()
	}),
	count: z.number(),
	netAmount: netAmountSchema,
	debit: directionTotalSchema,
	credit: directionTotalSchema
});

const summaryMetaSchema = collectionMetaSchema.extend({
	fromDateTime: z.iso.datetime(),
	toDateTime: z.iso.datetime(),
	groupBy: z.string().array(),
	interval: summaryIntervalSchema.optional()
});

export const summaryResponseSchema = z.object({
	totals: summaryTotalSchema,
	data: summaryItemSchema.array(),
	links: linksSchema,
	meta: summaryMetaSchema
});
