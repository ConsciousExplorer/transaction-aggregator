// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Loan-book movement: disbursement to customer or customer repayment. */
export const loanTransactionSchema = z.object({
	transactionId: z.string(),
	// Delivery identity: fresh UUIDv7 per emit, including redeliveries and chaos duplicates.
	eventId: z.string(),
	// Emit timestamp stamped by the producer at send time. 0 = unknown; the consumer records no ingest_lag_seconds observation for that message.
	producedAt: z.number(),
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
