// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Electronic Funds Transfer — inter-bank. debit = outbound push to a beneficiary; credit = inbound receipt (e.g. salary), where the beneficiary* fields describe the counterparty (the payer). */
export const eftTransactionSchema = z.object({
	transactionId: z.string(),
	sourceType: z.string(),
	customerId: z.string(),
	// Customer account the transaction occurred on.
	accountId: z.string(),
	beneficiaryName: z.string(),
	beneficiaryAccountNumber: z.string(),
	beneficiaryBank: z.string(),
	branchCode: z.string(),
	reference: z.string(),
	// Amount in ZAC (South African cents). Divide by 100 for display in ZAR.
	amount: z.number(),
	currency: z.string(),
	transactionType: z.string(),
	clearingType: z.string(),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type EftTransaction = z.infer<typeof eftTransactionSchema>;
