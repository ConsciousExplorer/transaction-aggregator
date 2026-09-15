import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	sourceSchema
} from "#src/domain/transaction.ts";
import type { CardTransaction } from "#src/generated/card.ts";

export function normaliseCard(
	record: CardTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		source: sourceSchema.enum.card,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		mcc: record.mccCode || null,
		counterpartyName: record.merchantName,
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
