// Generated from repository schemas — do not edit. Run npm run schema:generate

import { z } from "zod";

/** Card-present / card-not-present debit/credit card purchase. */
export const cardTransactionSchema = z.object({
	transactionId: z.string(),
	// What kind of transaction this is, with the same values as the database's transaction_type.
	transactionType: z.enum(["card", "eft", "debit_order", "internal_transfer"]),
	customerId: z.string(),
	// Customer account the transaction occurred on.
	accountId: z.string(),
	// Generation hint only — consumer derives category from mccCode/merchantName. Consumer Zod schema should strip this field.
	category: z.string(),
	merchantName: z.string(),
	mccCode: z.string(),
	// Amount in cents, the minor unit of ZAR. Divide by 100 for rands.
	amount: z.number(),
	currency: z.string(),
	// Whether the money came into the customer's account (credit) or left it (debit), as a bank statement shows it. The amount is always positive.
	creditDebitIndicator: z.enum(["credit", "debit"]),
	cardLast4: z.string(),
	cardNetwork: z.string(),
	posEntryMode: z.string(),
	authCode: z.string(),
	description: z.string(),
	status: z.string(),
	timestamp: z.number()
});

export type CardTransaction = z.infer<typeof cardTransactionSchema>;
