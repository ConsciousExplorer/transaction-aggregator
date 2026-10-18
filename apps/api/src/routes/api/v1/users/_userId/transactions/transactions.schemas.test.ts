import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { transactionItemSchema } from "./transactions.schemas.ts";

const ITEM = {
	transactionId: "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b",
	occurredAt: "2026-08-15T09:30:00.000Z",
	transactionType: "card",
	creditDebitIndicator: "debit",
	status: "completed",
	amount: { amountMinor: 1234, currency: "ZAR" },
	category: "groceries",
	shortDescription: "Spar"
};

suite("transactionItemSchema", () => {
	test("transactionType is required and one of the five types", () => {
		const { transactionType: _, ...withoutTransactionType } = ITEM;

		assert.strictEqual(transactionItemSchema.safeParse(ITEM).success, true);
		assert.strictEqual(
			transactionItemSchema.safeParse(withoutTransactionType).success,
			false
		);
		assert.strictEqual(
			transactionItemSchema.safeParse({ ...ITEM, transactionType: "cheque" })
				.success,
			false
		);
	});

	test("creditDebitIndicator is credit or debit", () => {
		assert.strictEqual(
			transactionItemSchema.safeParse({
				...ITEM,
				creditDebitIndicator: "sideways"
			}).success,
			false
		);
	});
});
