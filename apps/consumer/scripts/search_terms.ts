/**
 * Needle/haystack demo for the categorizer's keyword tier.
 * Run: node scripts/search_terms.ts
 */

// Compile step (once, at boot): needles lowercased, ascending priority order.
const keywordRules = [
	{ term: "uber eats", categoryId: 21, priority: 300 },
	{ term: "uber", categoryId: 20, priority: 305 },
	{ term: "art", categoryId: 22, priority: 310 } // substring trap — see below
];

// Match step (per transaction): build the haystack, first needle found wins.
const transactions = [
	{ merchantName: "UBER *TRIP", description: null },
	{ merchantName: "UBER", description: "EATS ORDER 42" }, // needle spans both fields
	{ merchantName: "Startup Inc", description: "invoice 7" }, // "art" ⊆ "startup"
	{ merchantName: "Spar", description: "groceries" } // no match → next tier
];

for (const { merchantName, description } of transactions) {
	const haystack = `${merchantName ?? ""} ${description ?? ""}`.toLowerCase();
	const hit = keywordRules.find(({ term }) => haystack.includes(term));

	console.log(
		`"${haystack}" →`,
		hit
			? `matched "${hit.term}" (category ${hit.categoryId})`
			: "no keyword match"
	);
}

// Speed: the scan is O(k·m) — k needles × m-char haystack, zero I/O.
// Maps (the mcc/stt/default tiers) are hash lookups: O(1) average, not O(n).
const haystack = "uber *trip za johannesburg card 1234";
const runs = 1_000_000;

const start = performance.now();
for (let i = 0; i < runs; i++) {
	keywordRules.find(({ term }) => haystack.includes(term));
}
const ms = performance.now() - start;

console.log(
	`${runs.toLocaleString()} lookups in ${ms.toFixed(0)} ms — ~${((ms / runs) * 1e6).toFixed(0)} ns per lookup`
);
