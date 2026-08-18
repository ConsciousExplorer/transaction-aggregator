import type z from "zod";
import type {
	canonicalTransactionSchema,
	directionSchema
} from "#src/domain/transaction.ts";
import type { EftTransaction } from "#src/generated/eft.ts";

export function normaliseEft(
	record: EftTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		source: "eft", // can also be the topic name etc. Depending on domain
		externalId: record.transactionId,
		occuredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		merchantName: null,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			beneficiaryName: record.beneficiaryName,
			beneficiaryAccountNumber: record.beneficiaryAccountNumber,
			beneficiaryBank: record.beneficiaryBank,
			branchCode: record.branchCode,
			reference: record.reference
		}
	};
}
