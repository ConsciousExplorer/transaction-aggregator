import type z from "zod";
import type {
	canonicalTransactionSchema,
	directionSchema
} from "#src/domain/transaction.ts";
import type { InternalTransferTransaction } from "#src/generated/internal_transfer.ts";

export function normaliseInternalTransfer(
	record: InternalTransferTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		source: "internal_transfer",
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		merchantName: null,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			from_account_id: record.fromAccountId,
			to_account_id: record.toAccountId,
			from_account_type: record.fromAccountType,
			to_account_type: record.toAccountType
		}
	};
}
