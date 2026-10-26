import z from "zod";
import { cursorDirectionSchema, windowDateTimeSchema } from "./common.ts";

export const transactionTypeSchema = z.enum([
	"card",
	"eft",
	"debit_order",
	"internal_transfer"
]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

// Whether money came into the account (credit) or left it (debit), as a bank
// statement shows it. ISO 20022 calls this the credit/debit indicator.
export const creditDebitIndicatorSchema = z.enum(["credit", "debit"]);
export type CreditDebitIndicator = z.infer<typeof creditDebitIndicatorSchema>;

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

// The summary's bucket size
export const summaryIntervalSchema = z.enum(["day", "week", "month"]);
export type SummaryInterval = z.infer<typeof summaryIntervalSchema>;

// The boundary row's keyset, which the query seeks from. occurredAt is exact to
// the microsecond, because rows can differ only in microseconds and a
// millisecond bound would skip or repeat them.
export const transactionCursorSchema = z.object({
	occurredAt: z.iso.datetime({ precision: 6 }),
	transactionId: z.uuid()
});
export type TransactionCursor = z.infer<typeof transactionCursorSchema>;

// What the opaque cursor in links carries: which way to read, and the row to
// read from
export const transactionPageCursorSchema = z.object({
	direction: cursorDirectionSchema,
	position: transactionCursorSchema
});

/**
 * The query parameters the transaction list and the summary share. Each route
 * extends it with its own. maxWindowDays only goes into toDateTime's
 * description; the routes check the window themselves.
 */
export function buildTransactionFilterQuerySchema(maxWindowDays: number) {
	return z.object({
		fromDateTime: windowDateTimeSchema,
		toDateTime: windowDateTimeSchema.describe(
			`Exclusive. At most ${maxWindowDays} days after fromDateTime`
		),
		accountId: z
			.union([z.uuid(), z.uuid().array()])
			.describe(
				"One or more of the user's accounts; all accounts when left out"
			)
			.optional(),
		transactionType: z
			.union([transactionTypeSchema, transactionTypeSchema.array()])
			.optional(),
		category: z.union([z.string(), z.string().array()]).optional(),
		creditDebitIndicator: z
			.union([creditDebitIndicatorSchema, creditDebitIndicatorSchema.array()])
			.optional(),
		amountMin: z.coerce.number().int().optional(),
		amountMax: z.coerce.number().int().optional()
	});
}
