import assert from "node:assert";
import { suite, test } from "node:test";
import { normaliseCard } from "#src/domain/normaliser/domain/card.ts";
import { normaliseDebitOrder } from "#src/domain/normaliser/domain/debit-order.ts";
import { normaliseEft } from "#src/domain/normaliser/domain/eft.ts";
import { normaliseInternalTransfer } from "#src/domain/normaliser/domain/internal-transfer.ts";
import { normaliseLoan } from "#src/domain/normaliser/domain/loan.ts";
import { canonicalTransactionSchema } from "#src/domain/transaction.ts";

const ACCOUNT_ID = "0d4f3a52-9c1b-4f6e-8a2d-5b7c9e1f3a60";

const base = {
	transactionId: "7f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
	customerId: "b1a2c3d4-e5f6-4a3b-8c7d-9e0f1a2b3c4d",
	accountId: ACCOUNT_ID,
	amount: 12345,
	currency: "ZAR",
	transactionType: "debit",
	description: "test",
	status: "COMPLETED",
	timestamp: 1787400000000
};

const cardWire = {
	...base,
	sourceType: "card",
	category: "GROCERIES",
	merchantName: "Checkers",
	mccCode: "5411",
	cardLast4: "1234",
	cardNetwork: "visa",
	posEntryMode: "chip",
	authCode: "654321"
};

const canonicalBase = {
	userId: base.customerId,
	accountId: ACCOUNT_ID,
	transactionType: "card",
	externalId: base.transactionId,
	occurredAt: new Date(base.timestamp).toISOString(),
	direction: "debit",
	currency: "ZAR",
	amountMinor: 12345,
	longDescription: null,
	shortDescription: null,
	mcc: null,
	metadata: {}
};

suite("canonical schema — transactionType enum", () => {
	// The canonical vocabulary mirrors the Postgres transaction_type enum
	// exactly: underscores, never the hyphenated config/topic spelling.
	const canonical = [
		"card",
		"eft",
		"loan",
		"debit_order",
		"internal_transfer"
	] as const;

	for (const transactionType of canonical) {
		test(`accepts canonical transactionType "${transactionType}"`, () => {
			const parsed = canonicalTransactionSchema.parse({
				...canonicalBase,
				transactionType
			});
			assert.strictEqual(parsed.transactionType, transactionType);
		});
	}

	for (const transactionType of ["debit-order", "internal-transfer"]) {
		test(`rejects config-vocabulary transactionType "${transactionType}"`, () => {
			const result = canonicalTransactionSchema.safeParse({
				...canonicalBase,
				transactionType
			});
			assert.strictEqual(result.success, false);
		});
	}

	test("rejects an arbitrary transactionType string", () => {
		const result = canonicalTransactionSchema.safeParse({
			...canonicalBase,
			transactionType: "crypto"
		});
		assert.strictEqual(result.success, false);
	});
});

suite("canonical schema — accountId", () => {
	test("accepts a uuid accountId and preserves it", () => {
		const parsed = canonicalTransactionSchema.parse(canonicalBase);
		assert.strictEqual(parsed.accountId, ACCOUNT_ID);
	});

	test("rejects a missing accountId", () => {
		const { accountId: _omitted, ...withoutAccount } = canonicalBase;
		const result = canonicalTransactionSchema.safeParse(withoutAccount);
		assert.strictEqual(result.success, false);
	});

	test("rejects a non-uuid accountId", () => {
		const result = canonicalTransactionSchema.safeParse({
			...canonicalBase,
			accountId: "not-a-uuid"
		});
		assert.strictEqual(result.success, false);
	});
});

suite("normalisers — canonical output", () => {
	test("card emits transactionType 'card' and maps accountId", () => {
		const canonical = normaliseCard(cardWire);
		assert.strictEqual(canonical.transactionType, "card");
		assert.strictEqual(canonical.accountId, ACCOUNT_ID);
	});

	test("card output passes canonical schema validation", () => {
		const result = canonicalTransactionSchema.safeParse(
			normaliseCard(cardWire)
		);
		assert.strictEqual(result.success, true);
	});

	test("eft emits transactionType 'eft' and maps accountId", () => {
		const canonical = normaliseEft({
			...base,
			sourceType: "eft",
			beneficiaryName: "J Doe",
			beneficiaryAccountNumber: "1234567890",
			beneficiaryBank: "FNB",
			branchCode: "250655",
			reference: "rent",
			clearingType: "standard"
		});
		assert.strictEqual(canonical.transactionType, "eft");
		assert.strictEqual(canonical.accountId, ACCOUNT_ID);
	});

	test("loan emits transactionType 'loan' and maps accountId", () => {
		const canonical = normaliseLoan({
			...base,
			sourceType: "loan",
			loanAccountId: "c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f",
			loanType: "personal",
			operation: "repayment",
			principalAmount: 10000,
			interestAmount: 2345
		});
		assert.strictEqual(canonical.transactionType, "loan");
		assert.strictEqual(canonical.accountId, ACCOUNT_ID);
	});

	test("internal transfer emits underscored transactionType 'internal_transfer'", () => {
		const canonical = normaliseInternalTransfer({
			...base,
			sourceType: "internal_transfer",
			fromAccountId: "11111111-2222-4333-8444-555555555555",
			toAccountId: "66666666-7777-4888-9999-aaaaaaaaaaaa",
			fromAccountType: "cheque",
			toAccountType: "savings"
		});
		assert.strictEqual(canonical.transactionType, "internal_transfer");
		assert.strictEqual(canonical.accountId, ACCOUNT_ID);
	});

	test("debit order emits underscored transactionType 'debit_order'", () => {
		const canonical = normaliseDebitOrder({
			...base,
			sourceType: "debit_order",
			mandateId: "m-123",
			category: "INSURANCE",
			creditorName: "Discovery Life",
			creditorAbbrevName: "DISCLIFE",
			collectionType: "NAEDO",
			frequency: "monthly"
		});
		assert.strictEqual(canonical.transactionType, "debit_order");
		assert.strictEqual(canonical.accountId, ACCOUNT_ID);
	});
});
