import assert from "node:assert";
import { suite, test } from "node:test";
import type {
	CanonicalTransactionSchema,
	DomainTransactionSchema
} from "#src/schemas/transaction.ts";
import type { Normaliser } from "#src/services/domain-normaliser.ts";
import type { RuleCategoriser } from "#src/services/rule-categoriser.ts";
import { createTransactionIngester } from "#src/services/transaction-ingester.ts";

function canonical(
	over: Partial<CanonicalTransactionSchema> = {}
): CanonicalTransactionSchema {
	return {
		userId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
		accountId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
		transactionType: "card",
		externalId: "ext-1",
		occurredAt: new Date("2026-01-01T10:00:00Z").toISOString(),
		direction: "debit",
		status: "completed",
		currency: "ZAR",
		amountMinor: 1999,
		longDescription: "WOOLWORTHS STORE",
		shortDescription: "Woolworths",
		metadata: { mcc: "5411" },
		...over
	};
}

const normaliserEmitting = (value: unknown): Normaliser => ({
	normalise: () => value as CanonicalTransactionSchema
});

const categoriser = {
	categorise: () => ({ categoryId: 10, ruleVersion: 1, rulePriority: 100 })
} as unknown as RuleCategoriser;

suite("transaction ingestion", () => {
	test("a valid transaction reaches the insert", async () => {
		let inserted = 0;
		const pool = {
			connect: async () => ({
				query: async (text: string) => {
					if (text.includes("INSERT INTO transactions")) inserted += 1;
					return { rows: [], rowCount: 1 };
				},
				release: () => {}
			})
		} as never;

		const ingester = createTransactionIngester(
			normaliserEmitting(canonical()),
			categoriser,
			pool
		);

		const outcome = await ingester.ingest([{} as DomainTransactionSchema]);

		assert.equal(inserted, 1, "the valid row is inserted");
		assert.equal(outcome.attempted, 1);
	});
});
