// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Recurring collection initiated by a creditor against an authorised mandate. */
export const debitOrderTransactionSchema = z.object({
	transactionId: z.string(),
	// What kind of transaction this is, with the same values as the database's transaction_type.
	transactionType: z.enum([
		"card",
		"eft",
		"loan",
		"debit_order",
		"internal_transfer"
	]),
	customerId: z.string(),
	// Customer account the transaction occurred on.
	accountId: z.string(),
	mandateId: z.string(),
	// Generation hint only — consumer derives category from creditorName. Consumer Zod schema should strip this field.
	category: z.string(),
	creditorName: z.string(),
	creditorAbbrevName: z.string(),
	collectionType: z.string(),
	frequency: z.string(),
	// Amount in cents, the minor unit of ZAR. Divide by 100 for rands.
	amount: z.number(),
	currency: z.string(),
	// Whether the money came into the customer's account (credit) or left it (debit), as a bank statement shows it. The amount is always positive.
	creditDebitIndicator: z.enum(["credit", "debit"]),
	description: z.string(),
	// Higher REVERSED ratio — failed debit order collections are common.
	status: z.string(),
	timestamp: z.number()
});

export type DebitOrderTransaction = z.infer<typeof debitOrderTransactionSchema>;
