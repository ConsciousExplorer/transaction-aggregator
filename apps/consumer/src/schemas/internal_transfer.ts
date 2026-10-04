// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Movement of funds between two accounts held by the same customer. */
export const internalTransferTransactionSchema = z.object({
	transactionId: z.string(),
	sourceType: z.string(),
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
	transactionType: z.string(),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type InternalTransferTransaction = z.infer<
	typeof internalTransferTransactionSchema
>;
