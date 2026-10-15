import assert from "node:assert";
import { suite, test } from "node:test";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { CardTransaction } from "#src/schemas/card.ts";
import type { EftTransaction } from "#src/schemas/eft.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import { normaliseTransaction } from "#src/services/domain-normaliser.ts";
import {
	buildCardRecord,
	castToDomainTransaction
} from "#src/services/test-records.ts";

suite("domain normaliser validation", () => {
	test("accepts a well-formed record and returns canonical fields", () => {
		const result = normaliseTransaction(
			castToDomainTransaction(buildCardRecord()),
			"card"
		);

		assert.equal(result.transactionType, "card");
		assert.equal(result.creditDebitIndicator, "debit");
		assert.equal(result.externalId, "txn-0001");
		assert.equal(result.amountMinor, 1999);
		assert.equal(result.occurredAt, new Date(1_790_000_000_000).toISOString());
	});

	test("rejects a credit/debit indicator the canonical enum does not allow", () => {
		// Avro decoding already refuses a symbol outside the enum. The canonical
		// parse is the second check, for a record that didn't come through Avro.
		const indicatorOutsideEnum =
			"DEBIT" as CardTransaction["creditDebitIndicator"];
		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(
						buildCardRecord({ creditDebitIndicator: indicatorOutsideEnum })
					),
					"card"
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.match(String(error.details.issues), /creditDebitIndicator/);
				return true;
			}
		);
	});

	test("passes every wire status through, lowercased, without filtering", () => {
		const cases = [
			{ wire: "COMPLETED", stored: "completed" },
			{ wire: "PENDING", stored: "pending" },
			{ wire: "REVERSED", stored: "reversed" },
			{ wire: "FAILED", stored: "failed" }
		];

		for (const { wire, stored } of cases) {
			const result = normaliseTransaction(
				castToDomainTransaction(buildCardRecord({ status: wire })),
				"card"
			);
			assert.equal(result.status, stored);
		}
	});

	test("rejects a status the canonical enum does not allow", () => {
		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(buildCardRecord({ status: "posted" })),
					"card"
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.match(String(error.details.issues), /status/);
				return true;
			}
		);
	});

	test("rejects an id that is not a uuid", () => {
		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(
						buildCardRecord({ customerId: "not-a-uuid" })
					),
					"card"
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.match(String(error.details.issues), /userId/);
				return true;
			}
		);
	});

	test("reports the offending record so the mapping bug is findable", () => {
		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(
						buildCardRecord({
							creditDebitIndicator:
								"purchase" as CardTransaction["creditDebitIndicator"]
						})
					),
					"card"
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.equal(error.details.externalId, "txn-0001");
				assert.equal(error.details.transactionType, "card");
				return true;
			}
		);
	});

	test("a malformed timestamp is dead-lettered, not thrown raw", () => {
		// `new Date(NaN).toISOString()` throws inside the mapping itself, so the
		// wrapper has to catch it or one bad record kills the whole batch.
		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(buildCardRecord({ timestamp: Number.NaN })),
					"card"
				),
			NonRetryableError
		);
	});
});

/** A well-formed EFT record as the producer emits it, every field set. */
function buildEftRecord(over: Partial<EftTransaction> = {}): EftTransaction {
	return {
		transactionId: "txn-0002",
		transactionType: "eft",
		customerId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		accountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
		beneficiaryName: "Thandi Mokoena",
		beneficiaryAccountNumber: "62001234567",
		beneficiaryBank: "TymeBank",
		branchCode: "678910",
		reference: "Rent October",
		amount: 850000,
		currency: "ZAR",
		creditDebitIndicator: "debit",
		clearingType: "same-day",
		description: "EFT TO THANDI MOKOENA",
		status: "COMPLETED",
		timestamp: 1_790_000_000_000,
		...over
	};
}

suite("EFT normaliser", () => {
	test("keeps the clearing type in metadata", () => {
		const result = normaliseTransaction(
			buildEftRecord() as unknown as DomainTransactionSchema,
			"eft"
		);

		assert.deepStrictEqual(result.metadata, {
			beneficiaryName: "Thandi Mokoena",
			beneficiaryAccountLast4: "4567",
			beneficiaryBank: "TymeBank",
			branchCode: "678910",
			reference: "Rent October",
			clearingType: "same-day"
		});
	});
});
