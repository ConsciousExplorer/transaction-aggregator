import assert from "node:assert";
import { suite, test } from "node:test";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { CardTransaction } from "#src/schemas/card.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import { createNormaliser } from "#src/services/domain-normaliser.ts";

/**
 * A well-formed card record as the producer emits it. Note the source schema
 * types every one of these as bare `z.string()`/`z.number()`, which is exactly
 * why the normaliser has to validate what it produces.
 */
function cardRecord(over: Partial<CardTransaction> = {}): CardTransaction {
	return {
		transactionId: "txn-0001",
		eventId: "0190c3f1-0000-7000-8000-000000000001",
		producedAt: 1_790_000_000_000,
		sourceType: "card",
		customerId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		accountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
		category: "groceries",
		merchantName: "Woolworths",
		mccCode: "5411",
		amount: 1999,
		currency: "ZAR",
		transactionType: "debit",
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

const asDomain = (record: CardTransaction) =>
	record as unknown as DomainTransactionSchema;

const cardNormaliser = createNormaliser("card");

suite("domain normaliser validation", () => {
	test("accepts a well-formed record and returns canonical fields", () => {
		const result = cardNormaliser.normalise(asDomain(cardRecord()));

		assert.equal(result.transactionType, "card");
		assert.equal(result.direction, "debit");
		assert.equal(result.externalId, "txn-0001");
		assert.equal(result.amountMinor, 1999);
		assert.equal(result.occurredAt, new Date(1_790_000_000_000).toISOString());
	});

	test("rejects a direction the canonical enum does not allow", () => {
		// The normaliser casts source `transactionType` straight to direction,
		// so only a runtime parse catches a producer sending different casing.
		assert.throws(
			() =>
				cardNormaliser.normalise(
					asDomain(cardRecord({ transactionType: "DEBIT" }))
				),
			(error: unknown) => {
				assert.ok(error instanceof NonRetryableError);
				assert.match(String(error.details.issues), /direction/);
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
			const result = cardNormaliser.normalise(
				asDomain(cardRecord({ status: wire }))
			);
			assert.equal(result.status, stored);
		}
	});

	test("rejects a status the canonical enum does not allow", () => {
		assert.throws(
			() =>
				cardNormaliser.normalise(asDomain(cardRecord({ status: "posted" }))),
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
				cardNormaliser.normalise(
					asDomain(cardRecord({ customerId: "not-a-uuid" }))
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
				cardNormaliser.normalise(
					asDomain(cardRecord({ transactionType: "purchase" }))
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
				cardNormaliser.normalise(
					asDomain(cardRecord({ timestamp: Number.NaN }))
				),
			NonRetryableError
		);
	});
});
