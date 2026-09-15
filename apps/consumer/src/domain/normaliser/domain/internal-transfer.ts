import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	transactionTypeSchema
} from "#src/domain/transaction.ts";
import type { InternalTransferTransaction } from "#src/generated/internal_transfer.ts";

export function normaliseInternalTransfer(
	record: InternalTransferTransaction
): z.infer<typeof canonicalTransactionSchema> {
	// The "other side" of the transfer, from this transaction's perspective —
	// a debit means money left to the `to` account; a credit means it arrived
	// from the `from` account.
	const otherAccountType =
		record.transactionType === "debit"
			? record.toAccountType
			: record.fromAccountType;

	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.internal_transfer,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		// e.g. "Savings Account" — the account type on the other side of the transfer
		shortDescription: `${otherAccountType.charAt(0).toUpperCase()}${otherAccountType.slice(1)} Account`,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			fromAccountId: record.fromAccountId,
			toAccountId: record.toAccountId,
			fromAccountType: record.fromAccountType,
			toAccountType: record.toAccountType
		}
	};
}
