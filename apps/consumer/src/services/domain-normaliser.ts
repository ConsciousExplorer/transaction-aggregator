import type z from "zod";
import type { CardTransaction } from "#src/schemas/card.ts";
import type { DebitOrderTransaction } from "#src/schemas/debit_order.ts";
import type { EftTransaction } from "#src/schemas/eft.ts";
import type { InternalTransferTransaction } from "#src/schemas/internal_transfer.ts";
import type { LoanTransaction } from "#src/schemas/loan.ts";
import {
	type CanonicalTransactionSchema,
	type directionSchema,
	type ExternalTransactionSchema,
	type TransactionType,
	transactionTypeSchema
} from "#src/schemas/transaction.ts";

export interface Normaliser {
	normalise(transaction: ExternalTransactionSchema): CanonicalTransactionSchema;
}

export type DomainNormaliser = (
	transaction: ExternalTransactionSchema
) => CanonicalTransactionSchema;

const NORMALIZERS: Record<TransactionType, DomainNormaliser> = {
	card: (record) => normaliseCard(record as CardTransaction),
	eft: (record) => normaliseEft(record as EftTransaction),
	loan: (record) => normaliseLoan(record as LoanTransaction),
	debit_order: (record) => normaliseDebitOrder(record as DebitOrderTransaction),
	internal_transfer: (record) =>
		normaliseInternalTransfer(record as InternalTransferTransaction)
};

export function createDomainNormaliser(
	transactionType: TransactionType
): DomainNormaliser {
	const normaliser = NORMALIZERS[transactionType];
	if (!normaliser)
		throw new Error(
			`No normaliser was found for transaction type ${transactionType}`
		);
	return normaliser;
}

export function createNormaliser(transaction: ExternalTransactionSchema) {
	const normaliser = createDomainNormaliser(
		transaction.sourceType as TransactionType
	);
	return {
		normalise(transaction: ExternalTransactionSchema) {
			return normaliser(transaction);
		}
	};
}

export function normaliseCard(
	record: CardTransaction
): CanonicalTransactionSchema {
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

export function normaliseDebitOrder(
	record: DebitOrderTransaction
): CanonicalTransactionSchema {
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

export function normaliseEft(
	record: EftTransaction
): CanonicalTransactionSchema {
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
		direction: record.transactionType as z.infer<typeof directionSchema>,
		metadata: {
			beneficiaryName: record.beneficiaryName,
			beneficiaryAccountLast4: record.beneficiaryAccountNumber.slice(-4),
			beneficiaryBank: record.beneficiaryBank,
			branchCode: record.branchCode,
			reference: record.reference
		}
	};
}

export function normaliseInternalTransfer(
	record: InternalTransferTransaction
): CanonicalTransactionSchema {
	// e.g looking from the Saving Account, we paid into the Loan Account
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

export function normaliseLoan(
	record: LoanTransaction
): CanonicalTransactionSchema {
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
