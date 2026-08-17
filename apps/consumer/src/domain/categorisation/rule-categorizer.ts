import type z from "zod";
import type { canonicalTransactionSchema } from "../transaction.ts";

export const MATCHER_TYPES = [
	"mcc",
	"keyword",
	"source_txn_type",
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
	matcherType: MatcherType | "fallback";
}

export interface RuleSet {
	version: number;
	rules: Rule[];
	uncategorizedId: number;
}
// How the categoriser works. Basically like a database cross join and selecting the first priority
export interface RuleCategorizer {
	categorize(transaction: z.infer<typeof canonicalTransactionSchema>): Verdict;
}

export function createRuleCategorizer(ruleset: RuleSet): RuleCategorizer {
	// This is where the hard logic loves. The categorizer uses the closure to do the hard work once
	const KEYWORD_SOURCES = new Set(["card", "debit_order"]);
	// const TIER_ORDER = [
	// 	"mcc",
	// 	"keyword",
	// 	"source_txn_type",
	// 	"source_default"
	// ] as const;

	const sorted = [...ruleset.rules].sort((a, b) => a.priority - b.priority);

	const mccMap = new Map<string, Rule>();
	const keywordRules: Array<{ term: string; rule: Rule }> = [];
	const sttMap = new Map<string, Rule>();
	const defaultMap = new Map<string, Rule>();

	for (const rule of sorted) {
		switch (rule.matcherType) {
			case "mcc":
				if (!mccMap.has(rule.pattern)) mccMap.set(rule.pattern, rule);
				break;
			case "source_txn_type":
				if (!sttMap.has(rule.pattern)) sttMap.set(rule.pattern, rule);
				break;
			case "keyword":
				keywordRules.push({ term: rule.pattern.toLowerCase(), rule });
				break;

			case "source_default":
				if (!defaultMap.has(rule.pattern)) defaultMap.set(rule.pattern, rule);
				break;
		}
	}

	const version = ruleset.version;
	const fallback: Verdict = {
		categoryId: ruleset.uncategorizedId,
		ruleVersion: ruleset.version,
		matcherType: "fallback"
	};
	const verdictOf = (rule: Rule): Verdict => ({
		categoryId: rule.categoryId,
		ruleVersion: version,
		matcherType: rule.matcherType
	});

	return {
		categorize(
			transaction: z.infer<typeof canonicalTransactionSchema>
		): Verdict {
			// Search order
			// 1. MCC first
			// 2. Keywords
			// 3. source type
			// 4. source defaults
			// 5. Fallback

			// 1
			if (transaction.mcc !== null) {
				const rule = mccMap.get(transaction.mcc);
				if (rule) {
					return verdictOf(rule);
				}
			}

			// 2
			if (KEYWORD_SOURCES.has(transaction.source)) {
				const terms =
					`${transaction.merchantName ?? ""} ${transaction.description ?? ""}`.toLowerCase();
				for (const { term, rule } of keywordRules) {
					if (terms.includes(term)) return verdictOf(rule);
				}
			}

			// 3
			const txnType = transaction.metadata.txn_type;
			if (typeof txnType === "string") {
				const rule = sttMap.get(`${transaction.source}:${txnType}`);
				if (rule) return verdictOf(rule);
			}

			// 4
			const rule = defaultMap.get(transaction.source);
			if (rule) return verdictOf(rule);

			return fallback;
		}
	};
}
