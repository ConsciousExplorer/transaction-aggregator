import type z from "zod";
import {
	type canonicalTransactionSchema,
	type directionSchema,
	sourceSchema
} from "#src/domain/transaction.ts";
import type { LoanTransaction } from "#src/generated/loan.ts";

export function normaliseLoan(
	record: LoanTransaction
): z.infer<typeof canonicalTransactionSchema> {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		source: sourceSchema.enum.loan,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		postedAt: null,
		description: record.description,
		counterpartyName: `${record.loanType.charAt(0).toUpperCase()}${record.loanType.slice(1)} Loan`,
		mcc: null,
		currency: record.currency,
		amountMinor: record.amount,
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			operation: record.operation,
			loanAccountId: record.loanAccountId,
			loanType: record.loanType,
			principalAmount: record.principalAmount,
			interestAmount: record.interestAmount
		}
	};
}
