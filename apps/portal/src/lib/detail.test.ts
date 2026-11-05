import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFundingSourceFields, buildReferenceFields } from "./detail.ts";
import type { EftFundingSource, TransactionDetail } from "./types.ts";

function buildEftFundingSource(branchCode: string | null): EftFundingSource {
	return {
		transactionType: "eft",
		beneficiaryName: "A Person",
		beneficiaryBank: "Nedbank",
		beneficiaryAccountLast4: "1234",
		branchCode,
		reference: "Rent",
		clearingType: "same_day"
	};
}

test("lists a card payment's funding details and leaves out what is null", () => {
	assert.deepEqual(
		buildFundingSourceFields({
			transactionType: "card",
			cardLast4: "4421",
			cardNetwork: "Visa",
			merchantName: "Nu Metro",
			mcc: "7832",
			authCode: null,
			posEntryMode: "contactless"
		}),
		[
			{ label: "Merchant", value: "Nu Metro" },
			{ label: "Card", value: "Visa ending 4421" },
			{ label: "Merchant category code", value: "7832" },
			{ label: "Entry mode", value: "contactless" }
		]
	);
});

test("lists an EFT's beneficiary with the branch only when there is one", () => {
	assert.deepEqual(buildFundingSourceFields(buildEftFundingSource("198765")), [
		{ label: "Beneficiary", value: "A Person" },
		{ label: "Bank", value: "Nedbank, branch 198765" },
		{ label: "Account ending", value: "1234" },
		{ label: "Reference", value: "Rent" },
		{ label: "Clearing", value: "same_day" }
	]);
	const withoutBranch = buildFundingSourceFields(buildEftFundingSource(null));
	assert.deepEqual(withoutBranch[1], { label: "Bank", value: "Nedbank" });
});

test("lists a debit order and an own transfer", () => {
	assert.deepEqual(
		buildFundingSourceFields({
			transactionType: "debit_order",
			creditorName: "Discovery",
			mandateId: "M-1",
			frequency: "monthly",
			collectionType: null
		}),
		[
			{ label: "Creditor", value: "Discovery" },
			{ label: "Mandate", value: "M-1" },
			{ label: "Frequency", value: "monthly" }
		]
	);
	assert.deepEqual(
		buildFundingSourceFields({
			transactionType: "internal_transfer",
			fromAccountId: "acc-1",
			fromAccountType: "cheque",
			toAccountId: "acc-2",
			toAccountType: "savings"
		}),
		[
			{ label: "From", value: "cheque account acc-1" },
			{ label: "To", value: "savings account acc-2" }
		]
	);
});

test("lists the reference ids in a fixed order", () => {
	const detail: TransactionDetail = {
		transactionId: "tx-1",
		accountId: "acc-1",
		externalId: "ext-1",
		occurredAt: "2026-10-01T00:00:00.000Z",
		creditDebitIndicator: "debit",
		amount: { amountMinor: 100, currency: "ZAR" },
		status: "completed",
		longDescription: null,
		shortDescription: null,
		category: "dining",
		fundingSource: buildEftFundingSource(null)
	};
	assert.deepEqual(buildReferenceFields(detail), [
		{ label: "External id", value: "ext-1" },
		{ label: "Account id", value: "acc-1" },
		{ label: "Transaction id", value: "tx-1" }
	]);
});
