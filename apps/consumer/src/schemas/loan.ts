// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Loan-book movement: disbursement to customer or customer repayment. */
export const loanTransactionSchema = z.object({
	transactionId: z.string(),
	sourceType: z.string(),
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
	transactionType: z.string(),
	description: z.string(),
	// Higher PENDING ratio — loan disbursements settle slower.
	status: z.string(),
	timestamp: z.number()
});

export type LoanTransaction = z.infer<typeof loanTransactionSchema>;
