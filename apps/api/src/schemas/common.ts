import z from "zod";

export const problemSchema = z.object({
	type: z.string(),
	title: z.string(),
	status: z.number(),
	detail: z.string().optional(),
	errors: z.array(z.unknown()).optional(),
	trace_id: z.string().optional()
});

// Every collection response is { data, links, meta }. links.self is the
// request as received; next and prev are relative links to the neighbouring
// pages, left out when there is no such page (always, on unpaginated
// collections).
export const linksSchema = z.object({
	self: z.string(),
	next: z.string().optional(),
	prev: z.string().optional()
});

export type Links = z.infer<typeof linksSchema>;

export const collectionMetaSchema = z.object({
	// Rows in data
	count: z.number().int()
});

// Money always travels with its currency, so an amount can never be read
// against another value's currency. amountMinor is in the currency's minor
// units (cents for ZAR).
export const amountSchema = z.object({
	amountMinor: z.number().int().describe("Always positive, in minor units"),
	currency: z.string().length(3)
});

// The one signed shape: a difference between two amounts, e.g. credit − debit
export const signedAmountSchema = z.object({
	amountMinor: z.number().int().describe("Signed, in minor units"),
	currency: z.string().length(3)
});
