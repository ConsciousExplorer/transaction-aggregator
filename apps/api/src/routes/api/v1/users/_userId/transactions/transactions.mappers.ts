import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { fundingSourceSchema } from "./transactions.schemas.ts";

type TransactionListRow = Awaited<
	ReturnType<UserTransactionRepository["seekTransactionPage"]>
>["rows"][number];

type TransactionDetailRow = NonNullable<
	Awaited<ReturnType<UserTransactionRepository["getTransactionDetail"]>>
>;

export function buildTransactionItem(row: TransactionListRow) {
	return {
		transactionId: row.transactionId,
		occurredAt: new Date(row.occurredAt).toISOString(),
		transactionType: row.transactionType,
		creditDebitIndicator: row.creditDebitIndicator,
		status: row.status,
		amount: {
			amountMinor: row.amountMinor,
			currency: row.currency
		},
		category: row.category,
		shortDescription: row.shortDescription
	};
}

export function buildTransactionDetail(row: TransactionDetailRow) {
	return {
		transactionId: row.transactionId,
		accountId: row.accountId,
		externalId: row.externalId,
		occurredAt: new Date(row.occurredAt).toISOString(),
		creditDebitIndicator: row.creditDebitIndicator,
		status: row.status,
		amount: {
			amountMinor: row.amountMinor,
			currency: row.currency
		},
		longDescription: row.longDescription,
		shortDescription: row.shortDescription,
		category: row.category,
		fundingSource: parseFundingSource(row.transactionType, row.metadata)
	};
}

export function parseFundingSource(
	transactionType: TransactionDetailRow["transactionType"],
	metadata: unknown
) {
	const raw = metadata as Record<string, unknown>;

	return fundingSourceSchema.parse({ transactionType, ...raw });
}
