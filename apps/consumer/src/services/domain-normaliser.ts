import type z from "zod";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { CardTransaction } from "#src/schemas/card.ts";
import type { DebitOrderTransaction } from "#src/schemas/debit_order.ts";
import type { EftTransaction } from "#src/schemas/eft.ts";
import type { InternalTransferTransaction } from "#src/schemas/internal_transfer.ts";
import type { LoanTransaction } from "#src/schemas/loan.ts";
import {
	type CanonicalTransactionSchema,
	canonicalTransactionSchema,
	type DomainTransactionSchema,
	type TransactionType,
	type transactionStatusSchema,
	transactionTypeSchema
} from "#src/schemas/transaction.ts";

/**
 * The source schemas type these fields as bare `z.string()`/`z.number()`, so
 * the casts below (the lowercased `status`, ids straight into `z.uuid()`) are
 * assertions, not guarantees. This is where the claim gets proved: a status
 * outside the enum or a non-UUID id is a mapping defect, so
 * it raises NonRetryableError and the batch handler dead-letters that record
 * instead of replaying it forever against the same bad mapping.
 */
function parseCanonical(transaction: CanonicalTransactionSchema) {
	const result = canonicalTransactionSchema.safeParse(transaction);

	if (!result.success) {
		const issues: string[] = [];
		for (const issue of result.error.issues) {
			issues.push(`${issue.path.join(".")}: ${issue.message}`);
		}
		throw new NonRetryableError("Normalised transaction failed validation", {
			cause: result.error,
			details: {
				transactionType: transaction.transactionType,
				externalId: transaction.externalId,
				issues
			}
		});
	}

	return result.data;
}

/**
 * Maps a wire record to the canonical shape and validates the result.
 * `transactionType` is the type this process was configured for
 * (`config.transactionType`, validated at startup), not the record's own field:
 * a process consumes a single topic.
 *
 * The mapping is wrapped as well as the parse: a malformed source timestamp
 * makes `new Date(ts).toISOString()` throw inside the mapping, and that is the
 * same class of defect — dead-letter the record, do not kill the batch.
 */
export function normaliseTransaction(
	transaction: DomainTransactionSchema,
	transactionType: TransactionType
) {
	let normalised: CanonicalTransactionSchema;

	try {
		normalised = mapToCanonical(transaction, transactionType);
	} catch (error) {
		if (error instanceof NonRetryableError) throw error;
		throw new NonRetryableError("Transaction could not be normalised", {
			cause: error,
			details: { transactionType: transaction.transactionType }
		});
	}

	return parseCanonical(normalised);
}

function mapToCanonical(
	transaction: DomainTransactionSchema,
	transactionType: TransactionType
) {
	// No default: every case returns, so a new transaction type without a case
	// makes this return undefined, and the caller fails to compile.
	switch (transactionType) {
		case transactionTypeSchema.enum.card:
			return normaliseCard(transaction as CardTransaction);
		case transactionTypeSchema.enum.eft:
			return normaliseEft(transaction as EftTransaction);
		case transactionTypeSchema.enum.loan:
			return normaliseLoan(transaction as LoanTransaction);
		case transactionTypeSchema.enum.debit_order:
			return normaliseDebitOrder(transaction as DebitOrderTransaction);
		case transactionTypeSchema.enum.internal_transfer:
			return normaliseInternalTransfer(
				transaction as InternalTransferTransaction
			);
	}
}

export function normaliseCard(record: CardTransaction) {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.card,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		shortDescription: record.merchantName,
		currency: record.currency,
		amountMinor: record.amount,
		creditDebitIndicator: record.creditDebitIndicator,
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
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

export function normaliseDebitOrder(record: DebitOrderTransaction) {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.debit_order,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		shortDescription: record.creditorName,
		currency: record.currency,
		amountMinor: record.amount,
		creditDebitIndicator: record.creditDebitIndicator,
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
		// The wire's category is the generator's hint, not a fact about the
		// debit order: the categoriser decides the category, so it is not kept
		metadata: {
			mandateId: record.mandateId,
			creditorName: record.creditorName,
			creditorAbbrevName: record.creditorAbbrevName,
			collectionType: record.collectionType,
			frequency: record.frequency
		}
	};
}

export function normaliseEft(record: EftTransaction) {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.eft,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		shortDescription: record.beneficiaryName,
		currency: record.currency,
		amountMinor: record.amount,
		creditDebitIndicator: record.creditDebitIndicator,
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
		metadata: {
			beneficiaryName: record.beneficiaryName,
			beneficiaryAccountLast4: record.beneficiaryAccountNumber.slice(-4),
			beneficiaryBank: record.beneficiaryBank,
			branchCode: record.branchCode,
			reference: record.reference,
			clearingType: record.clearingType
		}
	};
}

export function normaliseInternalTransfer(record: InternalTransferTransaction) {
	// e.g looking from the Saving Account, we paid into the Loan Account
	const otherAccountType =
		record.creditDebitIndicator === "debit"
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
		currency: record.currency,
		amountMinor: record.amount,
		creditDebitIndicator: record.creditDebitIndicator,
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
		metadata: {
			fromAccountId: record.fromAccountId,
			toAccountId: record.toAccountId,
			fromAccountType: record.fromAccountType,
			toAccountType: record.toAccountType
		}
	};
}

export function normaliseLoan(record: LoanTransaction) {
	return {
		userId: record.customerId,
		accountId: record.accountId,
		transactionType: transactionTypeSchema.enum.loan,
		externalId: record.transactionId,
		occurredAt: new Date(record.timestamp).toISOString(),
		longDescription: record.description,
		shortDescription: `${record.loanType.charAt(0).toUpperCase()}${record.loanType.slice(1)} Loan`,
		currency: record.currency,
		amountMinor: record.amount,
		creditDebitIndicator: record.creditDebitIndicator,
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
		metadata: {
			operation: record.operation,
			loanAccountId: record.loanAccountId,
			loanType: record.loanType,
			principalAmount: record.principalAmount,
			interestAmount: record.interestAmount
		}
	};
}
