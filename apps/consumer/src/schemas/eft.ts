// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Electronic Funds Transfer — inter-bank. debit = outbound push to a beneficiary; credit = inbound receipt (e.g. salary), where the beneficiary* fields describe the counterparty (the payer). */
export const eftTransactionSchema = z.object({
	transactionId: z.string(),
	// Delivery identity: fresh UUIDv7 per emit, including redeliveries and chaos duplicates.
	eventId: z.string(),
	// Emit timestamp stamped by the producer at send time. 0 = unknown; the consumer records no ingest_lag_seconds observation for that message.
	producedAt: z.number(),
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
