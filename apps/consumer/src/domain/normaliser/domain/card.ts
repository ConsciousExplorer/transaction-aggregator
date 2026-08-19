import type z from "zod";
import type {
	canonicalTransactionSchema,
	directionSchema
} from "#src/domain/transaction.ts";
import type { CardTransaction } from "#src/generated/card.ts";

export function normaliseCard(
	record: CardTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		source: "card", // can also be the topic name etc. Depending on domain
		externalId: record.transactionId,
		occuredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		mcc: record.mccCode || null,
		merchantName: record.merchantName,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			// Named for what it holds: four digits. The key "pan" is banned —
			// it reads as a full card number to redaction tooling and auditors.
			card_last4: record.cardLast4,
			card_network: record.cardNetwork,
			auth_code: record.authCode,
			pos_entry_mode: record.posEntryMode
		}
	};
}
