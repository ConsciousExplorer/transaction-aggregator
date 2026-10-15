import type { CardTransaction } from "#src/schemas/card.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";

// Wire records for tests. Not a .test.ts file, so the test runner does not run
// it as a suite.

/**
 * A well-formed card record as the producer emits it. Note the source schema
 * types every one of these as bare `z.string()`/`z.number()`, which is exactly
 * why the normaliser has to validate what it produces.
 */
export function buildCardRecord(
	over: Partial<CardTransaction> = {}
): CardTransaction {
	return {
		transactionId: "txn-0001",
		transactionType: "card",
		customerId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		accountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
		category: "groceries",
		merchantName: "Woolworths",
		mccCode: "5411",
		amount: 1999,
		currency: "ZAR",
		creditDebitIndicator: "debit",
		cardLast4: "4321",
		cardNetwork: "visa",
		posEntryMode: "chip",
		authCode: "A1B2C3",
		description: "WOOLWORTHS STORE",
		status: "COMPLETED",
		timestamp: 1_790_000_000_000,
		...over
	};
}

export function castToDomainTransaction(record: CardTransaction) {
	return record as unknown as DomainTransactionSchema;
}
