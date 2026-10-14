import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { parseFundingSource } from "./transactions.ts";

// EFT metadata exactly as stored before the consumer recorded clearingType
const storedEftMetadata = {
	reference: "Democratic very.",
	branchCode: "527490",
	beneficiaryBank: "TymeBank",
	beneficiaryName: "Jacqueline Mcgee",
	beneficiaryAccountLast4: "7922"
};

suite("parseFundingSource", () => {
	test("an EFT stored without clearingType maps with clearingType null", () => {
		assert.deepStrictEqual(
			parseFundingSource("eft", storedEftMetadata, "ZAR"),
			{
				transactionType: "eft",
				beneficiaryName: "Jacqueline Mcgee",
				beneficiaryAccountLast4: "7922",
				beneficiaryBank: "TymeBank",
				branchCode: "527490",
				reference: "Democratic very.",
				clearingType: null
			}
		);
	});

	test("an EFT stored with clearingType keeps it", () => {
		const metadata = { ...storedEftMetadata, clearingType: "same-day" };

		assert.deepStrictEqual(parseFundingSource("eft", metadata, "ZAR"), {
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
