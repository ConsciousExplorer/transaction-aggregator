// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Recurring collection initiated by a creditor against an authorised mandate. */
export const debitOrderTransactionSchema = z.object({
	transactionId: z.string(),
	// Delivery identity: fresh UUIDv7 per emit, including redeliveries and chaos duplicates.
	eventId: z.string(),
	// Emit timestamp stamped by the producer at send time. 0 = unknown; the consumer records no ingest_lag_seconds observation for that message.
	producedAt: z.number(),
	sourceType: z.string(),
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
	// Amount in ZAC (South African cents). Divide by 100 for display in ZAR.
	amount: z.number(),
	currency: z.string(),
	transactionType: z.string(),
	description: z.string(),
	// Higher REVERSED ratio — failed debit order collections are common.
	status: z.string(),
	timestamp: z.number()
});

export type DebitOrderTransaction = z.infer<typeof debitOrderTransactionSchema>;
