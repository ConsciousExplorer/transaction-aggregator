import type z from "zod";
import type { CardTransaction } from "#src/generated/card.ts";
import type { DebitOrderTransaction } from "#src/generated/debit_order.ts";
import type { EftTransaction } from "#src/generated/eft.ts";
import type { InternalTransferTransaction } from "#src/generated/internal_transfer.ts";
import type { LoanTransaction } from "#src/generated/loan.ts";
import type { SourceTypes } from "../source.ts";
import type { canonicalTransactionSchema } from "../transaction.ts";
import { normaliseCard } from "./domain/card.ts";
import { normaliseDebitOrder } from "./domain/debit-order.ts";
import { normaliseEft } from "./domain/eft.ts";
import { normaliseInternalTransfer } from "./domain/internal-transfer.ts";
import { normaliseLoan } from "./domain/loan.ts";

export type Normaliser = (
	record:
		| CardTransaction
		| LoanTransaction
		| EftTransaction
		| DebitOrderTransaction
		| InternalTransferTransaction
) => z.infer<typeof canonicalTransactionSchema>;

const NORMALIZERS: Partial<Record<SourceTypes, Normaliser>> = {
	card: (record) => normaliseCard(record as CardTransaction),
	eft: (record) => normaliseEft(record as EftTransaction),
	loan: (record) => normaliseLoan(record as LoanTransaction),
	"debit-order": (record) =>
		normaliseDebitOrder(record as DebitOrderTransaction),
	"internal-transfer": (record) =>
		normaliseInternalTransfer(record as InternalTransferTransaction)
};

export function createNormaliser(source: SourceTypes): Normaliser {
	const normaliser = NORMALIZERS[source];
	if (!normaliser)
		throw new Error(`No normaliser was found for source ${source}`);
	return normaliser;
}
