// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Loan-book movement: disbursement to customer or customer repayment. */
export const loanTransactionSchema = z.object({
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
	loanAccountId: z.string(),
	loanType: z.string(),
	operation: z.string(),
	// Amount in ZAR (South African cents). Divide by 100 for display in ZAR.
	amount: z.number(),
	// Principal in ZAR (South African cents).
	principalAmount: z.number(),
	// Interest in ZAR (South African cents).
	interestAmount: z.number(),
	currency: z.string(),
	// Whether the money came into the customer's account (credit) or left it (debit), as a bank statement shows it. The amount is always positive.
	creditDebitIndicator: z.enum(["credit", "debit"]),
	description: z.string(),
	// Higher PENDING ratio — loan disbursements settle slower.
	status: z.string(),
	timestamp: z.number()
});

export type LoanTransaction = z.infer<typeof loanTransactionSchema>;
