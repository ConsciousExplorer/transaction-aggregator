import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	sourceSchema
} from "#src/domain/transaction.ts";
import type { EftTransaction } from "#src/generated/eft.ts";

export function normaliseEft(
	record: EftTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		source: sourceSchema.enum.eft,
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
			beneficiary_name: record.beneficiaryName,
			// Truncated at the boundary: the full account number is PII and
			// must never reach the database.
			beneficiary_account_last4: record.beneficiaryAccountNumber.slice(-4),
			beneficiary_bank: record.beneficiaryBank,
			branch_code: record.branchCode,
			reference: record.reference
		}
	};
}
