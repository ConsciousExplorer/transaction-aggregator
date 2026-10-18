import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import type { CursorDirection } from "#src/schemas/common.ts";
import type { TransactionSort } from "#src/schemas/transactions.ts";
import { fundingSourceSchema } from "./transactions.schemas.ts";

type TransactionListRow = Awaited<
	ReturnType<UserTransactionRepository["getTransactions"]>
>[number];

type TransactionDetailRow = NonNullable<
	Awaited<ReturnType<UserTransactionRepository["getTransactionDetail"]>>
>;

/** The cursor a page boundary row hands to the next or previous page */
export function buildPageCursor(
	boundaryRow: TransactionListRow,
	direction: CursorDirection
) {
	return {
		direction,
		position: {
			occurredAt: boundaryRow.cursorOccurredAt,
			transactionId: boundaryRow.transactionId
		}
	};
}

/**
 * The order the repository reads a page in. next continues in the requested
 * sort order. prev reads against it from the cursor, so that LIMIT keeps the
 * rows nearest the cursor rather than the furthest; buildKeysetPage flips them
 * back.
 */
export function chooseReadSort(
	requestedSort: TransactionSort,
	cursorDirection: CursorDirection
) {
	if (cursorDirection === "next") {
		return requestedSort;
	}
	if (requestedSort === "occurredAt") {
		return "-occurredAt";
	}
	return "occurredAt";
}

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
		fundingSource: parseFundingSource(
			row.transactionType,
			row.metadata,
			row.currency
		)
	};
}

export function parseFundingSource(
	transactionType: TransactionDetailRow["transactionType"],
	metadata: unknown,
	currency: string
) {
	const raw = metadata as Record<string, unknown>;

	if (transactionType === "loan") {
		const { principalAmount, interestAmount, ...rest } = raw;
		return fundingSourceSchema.parse({
			transactionType,
			...rest,
			principal:
				typeof principalAmount === "number"
					? { amountMinor: principalAmount, currency }
					: null,
			interest:
				typeof interestAmount === "number"
					? { amountMinor: interestAmount, currency }
					: null
		});
	}

	return fundingSourceSchema.parse({ transactionType, ...raw });
}
