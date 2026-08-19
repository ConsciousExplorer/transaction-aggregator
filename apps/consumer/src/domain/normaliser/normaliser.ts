import type z from "zod";
import type { CardTransaction } from "#src/generated/card.ts";
import type { DebitOrderTransaction } from "#src/generated/debit_order.ts";
import type { EftTransaction } from "#src/generated/eft.ts";
import type { InternalTransferTransaction } from "#src/generated/internal_transfer.ts";
import type { LoanTransaction } from "#src/generated/loan.ts";
import type { canonicalTransactionSchema } from "../transaction.ts";
import { normaliseCard } from "./domain/card.ts";
import { normaliseDebitOrder } from "./domain/debit_order.ts";
import { normaliseEft } from "./domain/eft.ts";
import { normaliseInternalTransfer } from "./domain/internal_transfer.ts";
import { normaliseLoan } from "./domain/loan.ts";

export const SOURCE_TYPES = [
	"card",
	"eft",
	"loan",
	"debit_order",
	"internal_transfer"
] as const;
export type SourceTypes = (typeof SOURCE_TYPES)[number];
export type Normaliser = (
	record: unknown
) => z.infer<typeof canonicalTransactionSchema>;

const NORMALIZERS: Partial<Record<SourceTypes, Normaliser>> = {
	card: (record) => normaliseCard(record as CardTransaction),
	eft: (record) => normaliseEft(record as EftTransaction),
	loan: (record) => normaliseLoan(record as LoanTransaction),
	debit_order: (record) => normaliseDebitOrder(record as DebitOrderTransaction),
	internal_transfer: (record) =>
		normaliseInternalTransfer(record as InternalTransferTransaction)
};

export function createNormaliser(source: SourceTypes): Normaliser {
	const normaliser = NORMALIZERS[source];
	if (!normaliser)
		throw new Error(`No normaliser was found for source ${source}`);
	return normaliser;
}
