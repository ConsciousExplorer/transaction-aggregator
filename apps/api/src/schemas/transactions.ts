import z from "zod";
import { cursorDirectionSchema } from "./common.ts";

export const transactionTypeSchema = z.enum([
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
]);

// Whether money came into the account (credit) or left it (debit), as a bank
// statement shows it. ISO 20022 calls this the credit/debit indicator.
export const creditDebitIndicatorSchema = z.enum(["credit", "debit"]);

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

// The boundary row's keyset, which the query seeks from. occurredAt is exact to
// the microsecond, because rows can differ only in microseconds and a
// millisecond bound would skip or repeat them.
export const transactionCursorSchema = z.object({
	occurredAt: z.iso.datetime({ precision: 6 }),
	transactionId: z.uuid()
});

// What the opaque cursor in links carries: which way to read, and the row to
// read from
export const transactionPageCursorSchema = z.object({
	direction: cursorDirectionSchema,
	position: transactionCursorSchema
});
