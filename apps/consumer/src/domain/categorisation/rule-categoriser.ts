import type z from "zod";
import type { canonicalTransactionSchema } from "../transaction.ts";

export const KEYWORD_TRANSACTION_TYPES = new Set(["card", "debit_order"]);
export const MATCHER_TYPES = [
	"mcc",
	"keyword",
	"source_transaction_type",
	"source_direction",
	"source_default"
] as const;
export type MatcherType = (typeof MATCHER_TYPES)[number];

export interface Rule {
	priority: number;
	matcherType: MatcherType;
	pattern: string;
	categoryId: number;
	version: number;
}
export interface Verdict {
	categoryId: number;
	ruleVersion: number;
	rulePriority: number | null;
	matcherType: MatcherType | "fallback";
}

export interface RuleSet {
	version: number;
	rules: Rule[];
	uncategorisedId: number;
}
// How the categoriser works. Basically like a database cross join and selecting the first priority
export interface RuleCategoriser {
	categorise(transaction: z.infer<typeof canonicalTransactionSchema>): Verdict;
}

export function createRuleCategoriser(ruleset: RuleSet): RuleCategoriser {
	// Compile step: O(r log r) sort + O(r) map builds, paid once at boot —
	// categorise() does no per-message setup.
	const sorted = [...ruleset.rules].sort((a, b) => a.priority - b.priority);

	const mccMap = new Map<string, Rule>();
	const keywordRules: Array<{ term: string; rule: Rule }> = [];
	const sourceTransactionTypeMap = new Map<string, Rule>();
	const sourceDirectionMap = new Map<string, Rule>();
	const defaultMap = new Map<string, Rule>();

	for (const rule of sorted) {
		switch (rule.matcherType) {
			case "mcc":
				if (!mccMap.has(rule.pattern)) mccMap.set(rule.pattern, rule);
				break;
			case "source_transaction_type":
				if (!sourceTransactionTypeMap.has(rule.pattern))
					sourceTransactionTypeMap.set(rule.pattern, rule);
				break;
			case "keyword":
				keywordRules.push({ term: rule.pattern.toLowerCase(), rule });
				break;

			case "source_direction":
				if (!sourceDirectionMap.has(rule.pattern))
					sourceDirectionMap.set(rule.pattern, rule);
				break;

			case "source_default":
				if (!defaultMap.has(rule.pattern)) defaultMap.set(rule.pattern, rule);
				break;
		}
	}

	const version = ruleset.version;
	const fallback: Verdict = {
		categoryId: ruleset.uncategorisedId,
		ruleVersion: ruleset.version,
		rulePriority: null,
		matcherType: "fallback"
	};
	const verdictOf = (rule: Rule): Verdict => ({
		categoryId: rule.categoryId,
		ruleVersion: version,
		rulePriority: rule.priority,
		matcherType: rule.matcherType
	});

	return {
		categorise(
			transaction: z.infer<typeof canonicalTransactionSchema>
		): Verdict {
			// Search order and per-transaction cost (Map.get is a hash
			// lookup: O(1) average, not O(n)):
			// 1. MCC             — O(1) map lookup
			// 2. Keywords        — O(k·m): k terms scanned in priority order
			// 3. source:transaction_type — O(1) map lookup
			// 4. source:direction — O(1) map lookup
			// 5. source defaults — O(1) map lookup
			// 6. Fallback        — O(1), always succeeds

			// 1. MCC
			if (transaction.mcc !== null) {
				const rule = mccMap.get(transaction.mcc);
				if (rule) {
					return verdictOf(rule);
				}
			}

			// 2. Keywords
			if (KEYWORD_TRANSACTION_TYPES.has(transaction.transactionType)) {
				const terms =
					`${transaction.shortDescription ?? ""} ${transaction.longDescription ?? ""}`.toLowerCase();
				for (const { term, rule } of keywordRules) {
					if (terms.includes(term)) return verdictOf(rule);
				}
			}

			// 3. source:transaction_type
			const sourceTransactionType = transaction.metadata.transaction_type;
			if (typeof sourceTransactionType === "string") {
				const rule = sourceTransactionTypeMap.get(
					`${transaction.transactionType}:${sourceTransactionType}`
				);
				if (rule) return verdictOf(rule);
			}

			// 4. source:direction
			const directionRule = sourceDirectionMap.get(
				`${transaction.transactionType}:${transaction.direction}`
			);
			if (directionRule) return verdictOf(directionRule);

			// 5. source defaults
			const rule = defaultMap.get(transaction.transactionType);
			if (rule) return verdictOf(rule);

			// 6. Fallback
			return fallback;
		}
	};
}
