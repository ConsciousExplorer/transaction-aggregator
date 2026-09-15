import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	sourceSchema
} from "#src/domain/transaction.ts";
import type { DebitOrderTransaction } from "#src/generated/debit_order.ts";

export function normaliseDebitOrder(
	record: DebitOrderTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		source: sourceSchema.enum.debit_order,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		longDescription: record.description,
		shortDescription: record.creditorName,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			mandateId: record.mandateId,
			category: record.category,
			creditorName: record.creditorName,
			creditorAbbrevName: record.creditorAbbrevName,
			collectionType: record.collectionType,
			frequency: record.frequency
		}
	};
}
