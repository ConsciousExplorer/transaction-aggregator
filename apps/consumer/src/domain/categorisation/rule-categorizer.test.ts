import assert from "node:assert";
import { suite, test } from "node:test";
import type z from "zod";
import type { canonicalTransactionSchema } from "../transaction.ts";
import {
	createRuleCategorizer,
	type Rule,
	type RuleSet
} from "./rule-categorizer.ts";

type CanonicalTransaction = z.infer<typeof canonicalTransactionSchema>;

const makeRule = (over: Partial<Rule> = {}): Rule => ({
	priority: 100,
	matcherType: "mcc",
	pattern: "5411",
	categoryId: 10,
	version: 1,
	...over
});

// Ruleset version (7) deliberately differs from rule.version (1): a verdict
// must carry the loaded ruleset's version on every path, never the rule's own.
const makeRuleSet = (rules: Rule[], over: Partial<RuleSet> = {}): RuleSet => ({
	version: 7,
	rules,
	uncategorizedId: 999,
	...over
});

const makeTransaction = (
	over: Partial<CanonicalTransaction> = {}
): CanonicalTransaction => ({
	userId: "3f1d3aa4-8a3e-4a6e-9c93-2b9f6f1d8c11",
	source: "card",
	externalId: "txn-1",
	occuredAt: "2026-08-18",
	postedAt: null,
	direction: "debit",
	currency: "ZAR",
	amountMinor: 12_345,
	description: null,
	merchantName: null,
	mcc: null,
	metadata: {},
	...over
});

suite("creation", () => {
	test("returns a categorizer exposing categorize()", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([]));
		assert.strictEqual(typeof categorizer.categorize, "function");
	});

	test("empty ruleset categorizes everything to the fallback verdict", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([]));
		assert.deepStrictEqual(categorizer.categorize(makeTransaction()), {
			categoryId: 999,
			ruleVersion: 7,
			matcherType: "fallback"
		});
	});
});

suite("tier 1: mcc", () => {
	test("matches a transaction by exact mcc", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([makeRule({ matcherType: "mcc", pattern: "5411" })])
		);
		assert.deepStrictEqual(
			categorizer.categorize(makeTransaction({ mcc: "5411" })),
			{ categoryId: 10, ruleVersion: 7, matcherType: "mcc" }
		);
	});

	test("lowest priority wins when two rules share an mcc, regardless of input order", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({ pattern: "5411", priority: 110, categoryId: 11 }),
				makeRule({ pattern: "5411", priority: 105, categoryId: 12 })
			])
		);
		const verdict = categorizer.categorize(makeTransaction({ mcc: "5411" }));
		assert.strictEqual(verdict.categoryId, 12);
	});

	test("unknown mcc falls through", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([makeRule({ pattern: "5411" })])
		);
		const verdict = categorizer.categorize(makeTransaction({ mcc: "9999" }));
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 2: keyword", () => {
	const uberRule = makeRule({
		matcherType: "keyword",
		pattern: "Uber",
		priority: 305,
		categoryId: 20
	});

	test("matches case-insensitively against merchantName", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([uberRule]));
		assert.deepStrictEqual(
			categorizer.categorize(makeTransaction({ merchantName: "UBER *TRIP" })),
			{ categoryId: 20, ruleVersion: 7, matcherType: "keyword" }
		);
	});

	test("matches against description when merchantName is null", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([uberRule]));
		const verdict = categorizer.categorize(
			makeTransaction({ description: "uber trip 12 aug" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("lowest priority wins when two keywords both match", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({
					matcherType: "keyword",
					pattern: "delivery",
					priority: 310,
					categoryId: 21
				}),
				uberRule
			])
		);
		const verdict = categorizer.categorize(
			makeTransaction({ description: "uber delivery" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("applies to debit_order transactions", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([uberRule]));
		const verdict = categorizer.categorize(
			makeTransaction({ source: "debit_order", description: "uber one" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("is skipped for sources outside the keyword scope", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([uberRule]));
		const verdict = categorizer.categorize(
			makeTransaction({ source: "eft", description: "uber trip" })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 3: source_txn_type", () => {
	const repaymentRule = makeRule({
		matcherType: "source_txn_type",
		pattern: "loan:repayment",
		priority: 505,
		categoryId: 30
	});

	test("matches on source plus metadata.txn_type", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([repaymentRule]));
		assert.deepStrictEqual(
			categorizer.categorize(
				makeTransaction({
					source: "loan",
					metadata: { txn_type: "repayment" }
				})
			),
			{ categoryId: 30, ruleVersion: 7, matcherType: "source_txn_type" }
		);
	});

	test("same txn_type on a different source does not match", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([repaymentRule]));
		const verdict = categorizer.categorize(
			makeTransaction({ source: "eft", metadata: { txn_type: "repayment" } })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});

	test("non-string txn_type is ignored", () => {
		const categorizer = createRuleCategorizer(makeRuleSet([repaymentRule]));
		const verdict = categorizer.categorize(
			makeTransaction({ source: "loan", metadata: { txn_type: 42 } })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 4: source_default", () => {
	test("routes an otherwise unmatched transaction by its source", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({
					matcherType: "source_default",
					pattern: "internal_transfer",
					priority: 905,
					categoryId: 40
				})
			])
		);
		assert.deepStrictEqual(
			categorizer.categorize(makeTransaction({ source: "internal_transfer" })),
			{ categoryId: 40, ruleVersion: 7, matcherType: "source_default" }
		);
	});

	test("a source without a default falls through to the fallback", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({
					matcherType: "source_default",
					pattern: "card",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categorizer.categorize(makeTransaction({ source: "eft" }));
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier precedence", () => {
	test("mcc beats keyword", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({ matcherType: "mcc", pattern: "5411", categoryId: 10 }),
				makeRule({
					matcherType: "keyword",
					pattern: "spar",
					priority: 305,
					categoryId: 20
				})
			])
		);
		const verdict = categorizer.categorize(
			makeTransaction({ mcc: "5411", merchantName: "SPAR" })
		);
		assert.strictEqual(verdict.matcherType, "mcc");
	});

	test("keyword beats source_txn_type", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({
					matcherType: "keyword",
					pattern: "spar",
					priority: 305,
					categoryId: 20
				}),
				makeRule({
					matcherType: "source_txn_type",
					pattern: "card:purchase",
					priority: 505,
					categoryId: 30
				})
			])
		);
		const verdict = categorizer.categorize(
			makeTransaction({
				merchantName: "SPAR",
				metadata: { txn_type: "purchase" }
			})
		);
		assert.strictEqual(verdict.matcherType, "keyword");
	});

	test("source_txn_type beats source_default", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([
				makeRule({
					matcherType: "source_txn_type",
					pattern: "card:purchase",
					priority: 505,
					categoryId: 30
				}),
				makeRule({
					matcherType: "source_default",
					pattern: "card",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categorizer.categorize(
			makeTransaction({ metadata: { txn_type: "purchase" } })
		);
		assert.strictEqual(verdict.matcherType, "source_txn_type");
	});
});

suite("verdict versioning", () => {
	test("every verdict carries the ruleset version, not the rule's own", () => {
		const categorizer = createRuleCategorizer(
			makeRuleSet([makeRule({ version: 1 })])
		);
		const matched = categorizer.categorize(makeTransaction({ mcc: "5411" }));
		const fallback = categorizer.categorize(makeTransaction());
		assert.strictEqual(matched.ruleVersion, 7);
		assert.strictEqual(fallback.ruleVersion, 7);
	});
});
