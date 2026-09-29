import assert from "node:assert";
import { suite, test } from "node:test";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type {
	CanonicalTransactionSchema,
	DomainTransactionSchema
} from "#src/schemas/transaction.ts";
import type { Normaliser } from "#src/services/domain-normaliser.ts";
import { createTransactionIngestion } from "#src/services/ingestion.ts";
import type { RuleCategoriser } from "#src/services/rule-categoriser.ts";

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

/** Fails loudly if validation lets a bad record reach the database. */
const unreachablePool = {
	connect: async () => {
		throw new Error("the database must not be reached");
	}
} as never;

suite("transaction ingestion", () => {
	test("rejects a normalised transaction that fails the canonical schema", async () => {
		const ingest = createTransactionIngestion(
			normaliserEmitting({ userId: "not-a-uuid", occurredAt: "yesterday" }),
			categoriser,
			unreachablePool
		);

		await assert.rejects(
			() => ingest([{} as DomainTransactionSchema]),
			NonRetryableError,
			"a bad mapping is a code defect, not a transient fault"
		);
	});

	test("reports the offending field so the mapping bug is findable", async () => {
		const ingest = createTransactionIngestion(
			// A date-only occurredAt would collapse the dedupe key to day granularity.
			normaliserEmitting(canonical({ occurredAt: "2026-01-01" })),
			categoriser,
			unreachablePool
		);

		await assert.rejects(
			() => ingest([{} as DomainTransactionSchema]),
			(error) => {
				assert.ok(error instanceof NonRetryableError);
				assert.equal(error.details.externalId, "ext-1");
				assert.match(String(error.details.issues), /occurredAt/);
				return true;
			}
		);
	});

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

		const ingest = createTransactionIngestion(
			normaliserEmitting(canonical()),
			categoriser,
			pool
		);

		const outcome = await ingest([{} as DomainTransactionSchema]);

		assert.equal(inserted, 1, "the valid row is inserted");
		assert.equal(outcome.attempted, 1);
	});
});
