import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { transactions } from "#src/integrations/database/schemas/partitioned.ts";

type NewTransaction = typeof transactions.$inferInsert;

// The seed's pinned ids (database/migrations/0001_seed_categories_and_rules.sql)
export const CATEGORY_IDS = {
	groceries: 2,
	dining: 3,
	transport: 4,
	retail: 5,
	income: 11
};

/** What a test says about a row. Every other column gets a valid card value. */
export interface TransactionFixture {
	userId: string;
	occurredAt: string;
	creditDebitIndicator: NewTransaction["creditDebitIndicator"];
	amountMinor: number;
	categoryId: number;
	status?: NewTransaction["status"];
	accountId?: string;
	/** Left out, the table's default mints it, as for the consumer's inserts */
	transactionId?: string;
}

// The detail route parses a row's metadata by its transaction type, so every
// seeded card row carries what an ingested card row carries
const CARD_METADATA = {
	mcc: "5411",
	merchantName: "Spar",
	cardLast4: "1234",
	cardNetwork: "visa",
	posEntryMode: "chip",
	authCode: "A1B2C3"
};

/** The full row for a fixture, for inserts made outside insertTransactions */
export function buildTransactionRow(fixture: TransactionFixture) {
	const row: NewTransaction = {
		userId: fixture.userId,
		accountId: fixture.accountId ?? randomUUID(),
		transactionType: "card",
		externalId: randomUUID(),
		occurredAt: fixture.occurredAt,
		creditDebitIndicator: fixture.creditDebitIndicator,
		status: fixture.status ?? "completed",
		amountMinor: fixture.amountMinor,
		currency: "ZAR",
		shortDescription: "Spar",
		categoryId: fixture.categoryId,
		ruleVersion: 1,
		metadata: CARD_METADATA
	};
	if (fixture.transactionId !== undefined) {
		row.transactionId = fixture.transactionId;
	}
	return row;
}

/**
 * Inserts the rows as admin, which owns the table (api_write can't insert
 * transactions). One insert per row, so each returned row lines up with its
 * fixture.
 */
export async function insertTransactions(
	adminDatabase: NodePgDatabase,
	fixtures: TransactionFixture[]
) {
	const inserted = [];
	for (const fixture of fixtures) {
		const [row] = await adminDatabase
			.insert(transactions)
			.values(buildTransactionRow(fixture))
			.returning({
				transactionId: transactions.transactionId,
				occurredAt: transactions.occurredAt
			});
		if (!row) throw new Error("the insert returned no row");
		inserted.push(row);
	}
	return inserted;
}
