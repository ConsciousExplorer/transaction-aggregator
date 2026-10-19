// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Electronic Funds Transfer — inter-bank. debit = outbound push to a beneficiary; credit = inbound receipt (e.g. salary), where the beneficiary* fields describe the counterparty (the payer). */
export const eftTransactionSchema = z.object({
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
	beneficiaryName: z.string(),
	beneficiaryAccountNumber: z.string(),
	beneficiaryBank: z.string(),
	branchCode: z.string(),
	reference: z.string(),
	// Amount in cents, the minor unit of ZAR. Divide by 100 for rands.
	amount: z.number(),
	currency: z.string(),
	// Whether the money came into the customer's account (credit) or left it (debit), as a bank statement shows it. The amount is always positive.
	creditDebitIndicator: z.enum(["credit", "debit"]),
	clearingType: z.string(),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type EftTransaction = z.infer<typeof eftTransactionSchema>;
