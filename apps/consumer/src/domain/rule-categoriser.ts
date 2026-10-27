import type { CanonicalTransactionSchema } from "../schemas/transaction.ts";

export const KEYWORD_TRANSACTION_TYPES = new Set(["card", "debit_order"]);
export const MATCHER_TYPES = [
	"mcc",
	"keyword",
	"source_transaction_type",
	"source_credit_debit_indicator",
	"source_default"
] as const;
export type MatcherType = (typeof MATCHER_TYPES)[number];

export interface Rule {
	priority: number;
	matcherType: MatcherType;
	pattern: string;
	categoryId: number;
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
/** The verdict for a transaction the given rule matched */
function buildVerdict(rule: Rule, ruleVersion: number) {
	return {
		categoryId: rule.categoryId,
		ruleVersion,
		rulePriority: rule.priority,
		matcherType: rule.matcherType
	};
}

/**
 * The ruleset indexed once at boot, so `categoriseTransaction` does no
 * per-message setup. Works like a database cross join that keeps the first
 * match in priority order.
 */
export interface CompiledRules {
	version: number;
	mccRules: Map<string, Rule>;
	keywordRules: { term: string; rule: Rule }[];
	sourceTransactionTypeRules: Map<string, Rule>;
	sourceCreditDebitIndicatorRules: Map<string, Rule>;
	defaultRules: Map<string, Rule>;
	fallback: Verdict;
}

/** Keeps the first rule added for a pattern: the lowest priority. */
function addFirstRule(rulesByPattern: Map<string, Rule>, rule: Rule) {
	if (!rulesByPattern.has(rule.pattern)) {
		rulesByPattern.set(rule.pattern, rule);
	}
}

/**
 * Compile step: O(r log r) sort + O(r) map builds, paid once at boot. Within
 * a map the lowest priority wins, because the rules are added in priority order
 * and a pattern already present is never replaced.
 */
export function compileRules(ruleset: RuleSet) {
	const sorted = [...ruleset.rules].sort(
		(first, second) => first.priority - second.priority
	);

	const mccRules = new Map<string, Rule>();
	const keywordRules: { term: string; rule: Rule }[] = [];
	const sourceTransactionTypeRules = new Map<string, Rule>();
	const sourceCreditDebitIndicatorRules = new Map<string, Rule>();
	const defaultRules = new Map<string, Rule>();

	for (const rule of sorted) {
		switch (rule.matcherType) {
			case "mcc":
				addFirstRule(mccRules, rule);
				break;
			case "keyword":
				keywordRules.push({ term: rule.pattern.toLowerCase(), rule });
				break;
			case "source_transaction_type":
				addFirstRule(sourceTransactionTypeRules, rule);
				break;
			case "source_credit_debit_indicator":
				addFirstRule(sourceCreditDebitIndicatorRules, rule);
				break;
			case "source_default":
				addFirstRule(defaultRules, rule);
				break;
		}
	}

	const fallback: Verdict = {
		categoryId: ruleset.uncategorisedId,
		ruleVersion: ruleset.version,
		rulePriority: null,
		matcherType: "fallback"
	};

	return {
		version: ruleset.version,
		mccRules,
		keywordRules,
		sourceTransactionTypeRules,
		sourceCreditDebitIndicatorRules,
		defaultRules,
		fallback
	};
}

export function categoriseTransaction(
	transaction: CanonicalTransactionSchema,
	rules: CompiledRules
) {
	// Search order and per-transaction cost (Map.get is a hash
	// lookup: O(1) average, not O(n)):
	// 1. MCC             — O(1) map lookup
	// 2. Keywords        — O(k·m): k terms scanned in priority order
	// 3. source:transaction_type — O(1) map lookup
	// 4. source:credit/debit indicator — O(1) map lookup
	// 5. source defaults — O(1) map lookup
	// 6. Fallback        — O(1), always succeeds

	// 1. MCC
	if (typeof transaction.metadata.mcc === "string") {
		const rule = rules.mccRules.get(transaction.metadata.mcc);
		if (rule) {
			return buildVerdict(rule, rules.version);
		}
	}

	// 2. Keywords
	if (KEYWORD_TRANSACTION_TYPES.has(transaction.transactionType)) {
		const terms =
			`${transaction.shortDescription ?? ""} ${transaction.longDescription ?? ""}`.toLowerCase();
		for (const { term, rule } of rules.keywordRules) {
			if (terms.includes(term)) return buildVerdict(rule, rules.version);
		}
	}

	// 3. source:transaction_type — the source's own name for what happened,
	// which a normaliser stores as metadata.operation. The rules spell it
	// "{transactionType}:{operation}". No current normaliser sets it, so the
	// seeded ruleset has no rules in this tier.
	const sourceTransactionType = transaction.metadata.operation;
	if (typeof sourceTransactionType === "string") {
		const rule = rules.sourceTransactionTypeRules.get(
			`${transaction.transactionType}:${sourceTransactionType}`
		);
		if (rule) return buildVerdict(rule, rules.version);
	}

	// 4. source:credit/debit indicator
	const creditDebitIndicatorRule = rules.sourceCreditDebitIndicatorRules.get(
		`${transaction.transactionType}:${transaction.creditDebitIndicator}`
	);
	if (creditDebitIndicatorRule)
		return buildVerdict(creditDebitIndicatorRule, rules.version);

	// 5. source defaults
	const rule = rules.defaultRules.get(transaction.transactionType);
	if (rule) return buildVerdict(rule, rules.version);

	// 6. Fallback
	return rules.fallback;
}
