// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Movement of funds between two accounts held by the same customer. */
export const internalTransferTransactionSchema = z.object({
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
	fromAccountId: z.string(),
	toAccountId: z.string(),
	fromAccountType: z.string(),
	toAccountType: z.string(),
	// Amount in ZAC (South African cents). Divide by 100 for display in ZAR.
	amount: z.number(),
	currency: z.string(),
	// Whether the money came into the customer's account (credit) or left it (debit), as a bank statement shows it. The amount is always positive.
	creditDebitIndicator: z.enum(["credit", "debit"]),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type InternalTransferTransaction = z.infer<
	typeof internalTransferTransactionSchema
>;
