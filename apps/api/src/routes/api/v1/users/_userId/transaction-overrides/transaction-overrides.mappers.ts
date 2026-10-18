import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";

type TransactionOverrideRow = NonNullable<
	Awaited<ReturnType<UserTransactionRepository["setTransactionCategory"]>>
>;

export function buildTransactionOverride(override: TransactionOverrideRow) {
	return {
		transactionId: override.transactionId,
		categoryId: override.categoryId,
		updatedAt: new Date(override.updatedAt).toISOString()
	};
}
