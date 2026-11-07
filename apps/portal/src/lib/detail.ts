import type { FundingSource, TransactionDetail } from "./types.ts";

export interface DetailField {
	label: string;
	value: string;
}

// A field the API has no value for is left out rather than shown empty
function addField(fields: DetailField[], label: string, value: string | null) {
	if (value === null) return;
	fields.push({ label, value });
}

export function buildFundingSourceFields(fundingSource: FundingSource) {
	const fields: DetailField[] = [];
	if (fundingSource.transactionType === "card") {
		addField(fields, "Merchant", fundingSource.merchantName);
		addField(
			fields,
			"Card",
			`${fundingSource.cardNetwork} ending ${fundingSource.cardLast4}`
		);
		addField(fields, "Merchant category code", fundingSource.mcc);
		addField(fields, "Authorisation code", fundingSource.authCode);
		addField(fields, "Entry mode", fundingSource.posEntryMode);
	} else if (fundingSource.transactionType === "eft") {
		addField(fields, "Beneficiary", fundingSource.beneficiaryName);
		const bank =
			fundingSource.branchCode === null
				? fundingSource.beneficiaryBank
				: `${fundingSource.beneficiaryBank}, branch ${fundingSource.branchCode}`;
		addField(fields, "Bank", bank);
		addField(fields, "Account ending", fundingSource.beneficiaryAccountLast4);
		addField(fields, "Reference", fundingSource.reference);
		addField(fields, "Clearing", fundingSource.clearingType);
	} else if (fundingSource.transactionType === "debit_order") {
		addField(fields, "Creditor", fundingSource.creditorName);
		addField(fields, "Mandate", fundingSource.mandateId);
		addField(fields, "Frequency", fundingSource.frequency);
		addField(fields, "Collection", fundingSource.collectionType);
	} else {
		addField(
			fields,
			"From",
			`${fundingSource.fromAccountType} account ${fundingSource.fromAccountId}`
		);
		addField(
			fields,
			"To",
			`${fundingSource.toAccountType} account ${fundingSource.toAccountId}`
		);
	}
	return fields;
}

export function buildReferenceFields(detail: TransactionDetail) {
	const fields: DetailField[] = [];
	addField(fields, "External id", detail.externalId);
	addField(fields, "Account id", detail.accountId);
	addField(fields, "Transaction id", detail.transactionId);
	return fields;
}
