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
	type directionSchema,
	type TransactionType,
	type transactionStatusSchema,
	transactionTypeSchema
} from "#src/schemas/transaction.ts";

export interface Normaliser {
	normalise(transaction: DomainTransactionSchema): CanonicalTransactionSchema;
}

type DomainNormaliser = (
	transaction: DomainTransactionSchema
) => CanonicalTransactionSchema;

const NORMALISERS: Record<TransactionType, DomainNormaliser> = {
	card: (record) => normaliseCard(record as CardTransaction),
	eft: (record) => normaliseEft(record as EftTransaction),
	loan: (record) => normaliseLoan(record as LoanTransaction),
	debit_order: (record) => normaliseDebitOrder(record as DebitOrderTransaction),
	internal_transfer: (record) =>
		normaliseInternalTransfer(record as InternalTransferTransaction)
};

function lookupNormaliser(transactionType: TransactionType): DomainNormaliser {
	return NORMALISERS[transactionType];
}

/**
 * The source schemas type these fields as bare `z.string()`/`z.number()`, so
 * the casts below (`transactionType as directionSchema`, the lowercased
 * `status`, ids straight into `z.uuid()`) are assertions, not guarantees. This
 * is where the claim gets proved: a producer sending "DEBIT", a status outside
 * the enum or a non-UUID id is a mapping defect, so
 * it raises NonRetryableError and the batch handler dead-letters that record
 * instead of replaying it forever against the same bad mapping.
 */
function parseCanonical(
	transaction: CanonicalTransactionSchema
): CanonicalTransactionSchema {
	const result = canonicalTransactionSchema.safeParse(transaction);

	if (!result.success) {
		throw new NonRetryableError("Normalised transaction failed validation", {
			cause: result.error,
			details: {
				transactionType: transaction.transactionType,
				externalId: transaction.externalId,
				issues: result.error.issues.map(
					(issue) => `${issue.path.join(".")}: ${issue.message}`
				)
			}
		});
	}

	return result.data;
}

/**
 * Wraps the mapping itself as well as the parse: a malformed source timestamp
 * makes `new Date(ts).toISOString()` throw inside the normaliser, and that is
 * the same class of defect — dead-letter the record, do not kill the batch.
 */
function normaliseAndValidate(
	normalise: DomainNormaliser,
	transaction: DomainTransactionSchema
): CanonicalTransactionSchema {
	let normalised: CanonicalTransactionSchema;

	try {
		normalised = normalise(transaction);
	} catch (error) {
		if (error instanceof NonRetryableError) throw error;
		throw new NonRetryableError("Transaction could not be normalised", {
			cause: error,
			details: { sourceType: transaction.sourceType }
		});
	}

	return parseCanonical(normalised);
}

/**
 * Pins one transaction type up front, for a process that consumes a single
 * topic. `config.transactionType` is validated at startup, so an unknown type
 * fails before the consumer reads anything.
 */
export function createNormaliser(transactionType: TransactionType): Normaliser {
	const normalise = lookupNormaliser(transactionType);
	return {
		normalise: (transaction) => normaliseAndValidate(normalise, transaction)
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
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
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
		status: record.status.toLowerCase() as z.infer<
			typeof transactionStatusSchema
		>,
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
