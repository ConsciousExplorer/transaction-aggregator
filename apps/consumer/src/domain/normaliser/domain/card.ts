import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	transactionTypeSchema
} from "#src/domain/transaction.ts";
import type { CardTransaction } from "#src/generated/card.ts";

export function normaliseCard(
	record: CardTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.card,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		mcc: record.mccCode || null,
		shortDescription: record.merchantName,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			mcc: record.mccCode,
			merchantName: record.merchantName,
			cardLast4: record.cardLast4,
			cardNetwork: record.cardNetwork,
			authCode: record.authCode,
			posEntryMode: record.posEntryMode
		}
	};
}
