// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Card-present / card-not-present debit/credit card purchase. */
export const cardTransactionSchema = z.object({
	transactionId: z.string(),
	// Delivery identity: fresh UUIDv7 per emit, including redeliveries and chaos duplicates.
	eventId: z.string(),
	// Emit timestamp stamped by the producer at send time. 0 = unknown; the consumer records no ingest_lag_seconds observation for that message.
	producedAt: z.number(),
	sourceType: z.string(),
	customerId: z.string(),
	// Customer account the transaction occurred on.
	accountId: z.string(),
	// Generation hint only — consumer derives category from mccCode/merchantName. Consumer Zod schema should strip this field.
	category: z.string(),
	merchantName: z.string(),
	mccCode: z.string(),
	// Amount in ZAC (South African cents). Divide by 100 for display in ZAR.
	amount: z.number(),
	currency: z.string(),
	transactionType: z.string(),
	cardLast4: z.string(),
	cardNetwork: z.string(),
	posEntryMode: z.string(),
	authCode: z.string(),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type CardTransaction = z.infer<typeof cardTransactionSchema>;
