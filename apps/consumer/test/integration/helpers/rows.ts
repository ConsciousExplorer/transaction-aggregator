import { randomUUID } from "node:crypto";
import type { CategorisedTransactionSchema } from "#src/schemas/transaction.ts";

// The seed's pinned ids (database/migrations/0001_seed_categories_and_rules.sql)
export const CATEGORY_IDS = {
	uncategorised: 1,
	groceries: 2,
	income: 11
};

/**
 * A categorised card row as the ingester hands it to the insert. Its lineage
 * names a real rule in the seed (ruleset 1, priority 100: mcc 5411 →
 * groceries), because the insert's foreign key checks it.
 */
export function buildCategorisedRow(
	overrides: Partial<CategorisedTransactionSchema> = {}
) {
	const row: CategorisedTransactionSchema = {
		userId: randomUUID(),
		accountId: randomUUID(),
		transactionType: "card",
		externalId: randomUUID(),
		occurredAt: "2026-08-15T10:00:00.123Z",
		creditDebitIndicator: "debit",
		status: "completed",
		currency: "ZAR",
		amountMinor: 1999,
		longDescription: "WOOLWORTHS STORE",
		shortDescription: "Woolworths",
		metadata: { mcc: "5411" },
		categoryId: CATEGORY_IDS.groceries,
		ruleVersion: 1,
		rulePriority: 100,
		...overrides
	};
	return row;
}
