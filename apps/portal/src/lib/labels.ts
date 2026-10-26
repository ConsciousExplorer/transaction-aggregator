import type { Transaction, TransactionType } from "./types.ts";

// The words a customer reads for the API's enum values

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
	card: "Card",
	eft: "EFT",
	debit_order: "Debit order",
	internal_transfer: "Own transfer"
};

export const STATUS_LABELS: Record<Transaction["status"], string> = {
	completed: "Completed",
	pending: "Pending",
	reversed: "Reversed",
	failed: "Failed"
};
