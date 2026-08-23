import type z from "zod";
import type {
	canonicalTransactionSchema,
	directionSchema
} from "#src/domain/transaction.ts";
import type { DebitOrderTransaction } from "#src/generated/debit_order.ts";

export function normaliseDebitOrder(
	record: DebitOrderTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		source: "debit_order",
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		// debit_order is keyword-scoped: the creditor feeds the keyword haystack
		merchantName: record.creditorName,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			mandate_id: record.mandateId,
			category: record.category,
			creditor_abbrev_name: record.creditorAbbrevName,
			collection_type: record.collectionType,
			frequency: record.frequency
		}
	};
}
