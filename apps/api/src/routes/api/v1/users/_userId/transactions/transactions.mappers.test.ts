import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { parseFundingSource } from "./transactions.mappers.ts";

// EFT metadata exactly as stored before the consumer recorded clearingType
const STORED_EFT_METADATA = {
	reference: "Democratic very.",
	branchCode: "527490",
	beneficiaryBank: "TymeBank",
	beneficiaryName: "Jacqueline Mcgee",
	beneficiaryAccountLast4: "7922"
};

suite("parseFundingSource", () => {
	test("an EFT stored without clearingType maps with clearingType null", () => {
		assert.deepStrictEqual(parseFundingSource("eft", STORED_EFT_METADATA), {
			transactionType: "eft",
			beneficiaryName: "Jacqueline Mcgee",
			beneficiaryAccountLast4: "7922",
			beneficiaryBank: "TymeBank",
			branchCode: "527490",
			reference: "Democratic very.",
			clearingType: null
		});
	});

	test("an EFT stored with clearingType keeps it", () => {
		const metadata = { ...STORED_EFT_METADATA, clearingType: "same-day" };

		assert.deepStrictEqual(parseFundingSource("eft", metadata), {
			transactionType: "eft",
			beneficiaryName: "Jacqueline Mcgee",
			beneficiaryAccountLast4: "7922",
			beneficiaryBank: "TymeBank",
			branchCode: "527490",
			reference: "Democratic very.",
			clearingType: "same-day"
		});
	});
});
