// domain sources
export const SOURCE_TYPES = [
	"card",
	"eft",
	"loan",
	"debit-order",
	"internal-transfer"
] as const;

export type SourceTypes = (typeof SOURCE_TYPES)[number];
