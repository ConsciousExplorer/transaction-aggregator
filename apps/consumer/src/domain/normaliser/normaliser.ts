import type z from "zod";
import type { CardTransaction } from "#src/generated/card.ts";
import type { EftTransaction } from "#src/generated/eft.ts";
import type { canonicalTransactionSchema } from "../transaction.ts";
import { normaliseCard } from "./domain/card.ts";
import { normaliseEft } from "./domain/eft.ts";

export const SOURCE_TYPES = ["card", "eft", "loan", "debit_order"] as const;
export type SourceTypes = (typeof SOURCE_TYPES)[number];
export type Normaliser = (
	record: unknown
) => z.infer<typeof canonicalTransactionSchema>;

const NORMALIZERS: Partial<Record<SourceTypes, Normaliser>> = {
	card: (record) => normaliseCard(record as CardTransaction),
	eft: (record) => normaliseEft(record as EftTransaction)
};

export function createNormaliser(source: SourceTypes): Normaliser {
	const normaliser = NORMALIZERS[source];
	if (!normaliser)
		throw new Error(`No normaliser was found for source ${source}`);
	return normaliser;
}
