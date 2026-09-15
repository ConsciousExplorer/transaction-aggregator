import assert from "node:assert";
import { suite, test } from "node:test";
import type z from "zod";
import type { canonicalTransactionSchema } from "../transaction.ts";
import {
	createRuleCategoriser,
	type Rule,
	type RuleSet
} from "./rule-categoriser.ts";

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
	uncategorisedId: 999,
	...over
});

const makeTransaction = (
	over: Partial<CanonicalTransaction> = {}
): CanonicalTransaction => ({
	userId: "3f1d3aa4-8a3e-4a6e-9c93-2b9f6f1d8c11",
	accountId: "0d4f3a52-9c1b-4f6e-8a2d-5b7c9e1f3a60",
	source: "card",
	externalId: "txn-1",
	occurredAt: "2026-08-18",
	postedAt: null,
	direction: "debit",
	currency: "ZAR",
	amountMinor: 12_345,
	description: null,
	counterpartyName: null,
	mcc: null,
	metadata: {},
	...over
});

suite("creation", () => {
	test("returns a categoriser exposing categorise()", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([]));
		assert.strictEqual(typeof categoriser.categorise, "function");
	});

	test("empty ruleset categorises everything to the fallback verdict", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([]));
		assert.deepStrictEqual(categoriser.categorise(makeTransaction()), {
			categoryId: 999,
			ruleVersion: 7,
			rulePriority: null,
			matcherType: "fallback"
		});
	});
});

suite("tier 1: mcc", () => {
	test("matches a transaction by exact mcc", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([makeRule({ matcherType: "mcc", pattern: "5411" })])
		);
		assert.deepStrictEqual(
			categoriser.categorise(makeTransaction({ mcc: "5411" })),
			{ categoryId: 10, ruleVersion: 7, rulePriority: 100, matcherType: "mcc" }
		);
	});

	test("lowest priority wins when two rules share an mcc, regardless of input order", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({ pattern: "5411", priority: 110, categoryId: 11 }),
				makeRule({ pattern: "5411", priority: 105, categoryId: 12 })
			])
		);
		const verdict = categoriser.categorise(makeTransaction({ mcc: "5411" }));
		assert.strictEqual(verdict.categoryId, 12);
	});

	test("unknown mcc falls through", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([makeRule({ pattern: "5411" })])
		);
		const verdict = categoriser.categorise(makeTransaction({ mcc: "9999" }));
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

	test("matches case-insensitively against counterpartyName", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([uberRule]));
		assert.deepStrictEqual(
			categoriser.categorise(makeTransaction({ counterpartyName: "UBER *TRIP" })),
			{
				categoryId: 20,
				ruleVersion: 7,
				rulePriority: 305,
				matcherType: "keyword"
			}
		);
	});

	test("matches against description when counterpartyName is null", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([uberRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ description: "uber trip 12 aug" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("lowest priority wins when two keywords both match", () => {
		const categoriser = createRuleCategoriser(
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
		const verdict = categoriser.categorise(
			makeTransaction({ description: "uber delivery" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("applies to debit_order transactions", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([uberRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ source: "debit_order", description: "uber one" })
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("is skipped for sources outside the keyword scope", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([uberRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ source: "eft", description: "uber trip" })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 3: source_transaction_type", () => {
	const repaymentRule = makeRule({
		matcherType: "source_transaction_type",
		pattern: "loan:repayment",
		priority: 505,
		categoryId: 30
	});

	test("matches on source plus metadata.transaction_type", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([repaymentRule]));
		assert.deepStrictEqual(
			categoriser.categorise(
				makeTransaction({
					source: "loan",
					metadata: { transaction_type: "repayment" }
				})
			),
			{
				categoryId: 30,
				ruleVersion: 7,
				rulePriority: 505,
				matcherType: "source_transaction_type"
			}
		);
	});

	test("same transaction_type on a different source does not match", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([repaymentRule]));
		const verdict = categoriser.categorise(
			makeTransaction({
				source: "eft",
				metadata: { transaction_type: "repayment" }
			})
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});

	test("non-string transaction_type is ignored", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([repaymentRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ source: "loan", metadata: { transaction_type: 42 } })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 4: source_direction", () => {
	const eftCreditRule = makeRule({
		matcherType: "source_direction",
		pattern: "eft:credit",
		priority: 705,
		categoryId: 50
	});

	test("matches on source plus direction", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([eftCreditRule]));
		assert.deepStrictEqual(
			categoriser.categorise(
				makeTransaction({ source: "eft", direction: "credit" })
			),
			{
				categoryId: 50,
				ruleVersion: 7,
				rulePriority: 705,
				matcherType: "source_direction"
			}
		);
	});

	test("same direction on a different source does not match", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([eftCreditRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ source: "internal_transfer", direction: "credit" })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});

	test("opposite direction on the same source does not match", () => {
		const categoriser = createRuleCategoriser(makeRuleSet([eftCreditRule]));
		const verdict = categoriser.categorise(
			makeTransaction({ source: "eft", direction: "debit" })
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 5: source_default", () => {
	test("routes an otherwise unmatched transaction by its source", () => {
		const categoriser = createRuleCategoriser(
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
			categoriser.categorise(makeTransaction({ source: "internal_transfer" })),
			{
				categoryId: 40,
				ruleVersion: 7,
				rulePriority: 905,
				matcherType: "source_default"
			}
		);
	});

	test("a source without a default falls through to the fallback", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({
					matcherType: "source_default",
					pattern: "card",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categoriser.categorise(makeTransaction({ source: "eft" }));
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier precedence", () => {
	test("mcc beats keyword", () => {
		const categoriser = createRuleCategoriser(
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
		const verdict = categoriser.categorise(
			makeTransaction({ mcc: "5411", counterpartyName: "SPAR" })
		);
		assert.strictEqual(verdict.matcherType, "mcc");
	});

	test("keyword beats source_transaction_type", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({
					matcherType: "keyword",
					pattern: "spar",
					priority: 305,
					categoryId: 20
				}),
				makeRule({
					matcherType: "source_transaction_type",
					pattern: "card:purchase",
					priority: 505,
					categoryId: 30
				})
			])
		);
		const verdict = categoriser.categorise(
			makeTransaction({
				counterpartyName: "SPAR",
				metadata: { transaction_type: "purchase" }
			})
		);
		assert.strictEqual(verdict.matcherType, "keyword");
	});

	test("source_transaction_type beats source_default", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({
					matcherType: "source_transaction_type",
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
		const verdict = categoriser.categorise(
			makeTransaction({ metadata: { transaction_type: "purchase" } })
		);
		assert.strictEqual(verdict.matcherType, "source_transaction_type");
	});

	test("source_transaction_type beats source_direction", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({
					matcherType: "source_transaction_type",
					pattern: "eft:incoming",
					priority: 505,
					categoryId: 30
				}),
				makeRule({
					matcherType: "source_direction",
					pattern: "eft:credit",
					priority: 705,
					categoryId: 50
				})
			])
		);
		const verdict = categoriser.categorise(
			makeTransaction({
				source: "eft",
				direction: "credit",
				metadata: { transaction_type: "incoming" }
			})
		);
		assert.strictEqual(verdict.matcherType, "source_transaction_type");
	});

	test("source_direction beats source_default", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([
				makeRule({
					matcherType: "source_direction",
					pattern: "eft:credit",
					priority: 705,
					categoryId: 50
				}),
				makeRule({
					matcherType: "source_default",
					pattern: "eft",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categoriser.categorise(
			makeTransaction({ source: "eft", direction: "credit" })
		);
		assert.strictEqual(verdict.matcherType, "source_direction");
	});
});

suite("verdict versioning", () => {
	test("every verdict carries the ruleset version, not the rule's own", () => {
		const categoriser = createRuleCategoriser(
			makeRuleSet([makeRule({ version: 1 })])
		);
		const matched = categoriser.categorise(makeTransaction({ mcc: "5411" }));
		const fallback = categoriser.categorise(makeTransaction());
		assert.strictEqual(matched.ruleVersion, 7);
		assert.strictEqual(fallback.ruleVersion, 7);
	});
});
