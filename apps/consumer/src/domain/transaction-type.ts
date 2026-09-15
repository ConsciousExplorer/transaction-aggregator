// domain transaction types
export const TRANSACTION_TYPES = [
	"card",
	"eft",
	"loan",
	"debit-order",
	"internal-transfer"
] as const;

export type TransactionTypes = (typeof TRANSACTION_TYPES)[number];
