import assert from "node:assert";
import { suite, test } from "node:test";
import {
	buildCardRecord,
	buildDebitOrderRecord,
	castToDomainTransaction
} from "#src/domain/test-records.ts";
import { normaliseTransaction } from "#src/domain/transaction-normaliser.ts";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { CardTransaction } from "#src/schemas/card.ts";
import type { EftTransaction } from "#src/schemas/eft.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The record fails normalisation as a bad record, and the issue names the field. */
function assertRejectedOn(record: CardTransaction, field: string) {
	assert.throws(
		() => normaliseTransaction(castToDomainTransaction(record), "card"),
		(error: unknown) => {
			assert.ok(error instanceof NonRetryableError);
			assert.match(String(error.details.issues), new RegExp(field));
			return true;
		}
	);
}

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

	// Stored, it would land in the default partition, past the monthly
	// partitions made so far, and stop partition maintenance for the table
	test("a transaction dated more than a day ahead is dead-lettered", () => {
		const twoDaysAhead = Date.now() + 2 * MILLISECONDS_PER_DAY;

		assert.throws(
			() =>
				normaliseTransaction(
					castToDomainTransaction(buildCardRecord({ timestamp: twoDaysAhead })),
					"card"
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.match(String(error.details.issues), /occurredAt/);
				return true;
			}
		);
	});

	test("a producer clock a few minutes fast is not a bad record", () => {
		const fiveMinutesAhead = Date.now() + 5 * 60 * 1000;

		const result = normaliseTransaction(
			castToDomainTransaction(buildCardRecord({ timestamp: fiveMinutesAhead })),
			"card"
		);

		assert.equal(result.occurredAt, new Date(fiveMinutesAhead).toISOString());
	});

	// Past these limits a value doesn't fit the database's indexes, and the
	// insert fails with an error the consumer retries rather than dead-letters
	test("a field too long for the database's indexes is dead-lettered", () => {
		const cases = [
			{
				field: "externalId",
				record: buildCardRecord({ transactionId: "x".repeat(256) })
			},
			{
				field: "shortDescription",
				record: buildCardRecord({ merchantName: "m".repeat(256) })
			},
			{
				field: "longDescription",
				record: buildCardRecord({ description: "d".repeat(1001) })
			}
		];

		for (const { field, record } of cases) {
			assertRejectedOn(record, field);
		}
	});

	test("values at the length limits pass", () => {
		const result = normaliseTransaction(
			castToDomainTransaction(
				buildCardRecord({
					transactionId: "x".repeat(255),
					merchantName: "m".repeat(255),
					description: "d".repeat(1000)
				})
			),
			"card"
		);

		assert.equal(result.externalId.length, 255);
		assert.equal(result.shortDescription?.length, 255);
		assert.equal(result.longDescription?.length, 1000);
	});

	test("a currency that is not three capital letters is dead-lettered", () => {
		for (const currency of ["zar", "ZA", "RAND"]) {
			assertRejectedOn(buildCardRecord({ currency }), "currency");
		}
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

suite("debit order normaliser", () => {
	// The wire's category is the generator's hint; the categoriser decides
	test("leaves the wire's category hint out of metadata", () => {
		const result = normaliseTransaction(buildDebitOrderRecord(), "debit_order");

		assert.deepStrictEqual(result.metadata, {
			mandateId: "MND-000123",
			creditorName: "Discovery Life",
			creditorAbbrevName: "DISCLIFE",
			collectionType: "recurring",
			frequency: "monthly"
		});
	});
});
