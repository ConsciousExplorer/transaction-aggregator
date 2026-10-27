import assert from "node:assert";
import { suite, test } from "node:test";
import type z from "zod";
import type { canonicalTransactionSchema } from "../schemas/transaction.ts";
import {
	categoriseTransaction,
	compileRules,
	type Rule
} from "./rule-categoriser.ts";
import { buildDebitOrderRecord } from "./test-records.ts";
import { normaliseTransaction } from "./transaction-normaliser.ts";

type CanonicalTransaction = z.infer<typeof canonicalTransactionSchema>;

function buildRule(over: Partial<Rule> = {}): Rule {
	return {
		priority: 100,
		matcherType: "mcc",
		pattern: "5411",
		categoryId: 10,
		...over
	};
}

// Every verdict below expects ruleVersion 7, the loaded ruleset's version, on
// every path, the fallback included
function buildRuleSet(rules: Rule[]) {
	return {
		version: 7,
		rules,
		uncategorisedId: 999
	};
}

function buildTransaction(
	over: Partial<CanonicalTransaction> = {}
): CanonicalTransaction {
	return {
		userId: "3f1d3aa4-8a3e-4a6e-9c93-2b9f6f1d8c11",
		accountId: "0d4f3a52-9c1b-4f6e-8a2d-5b7c9e1f3a60",
		transactionType: "card",
		externalId: "txn-1",
		occurredAt: "2026-08-18",
		creditDebitIndicator: "debit",
		status: "completed",
		currency: "ZAR",
		amountMinor: 12_345,
		longDescription: null,
		shortDescription: null,
		metadata: {},
		...over
	};
}

suite("creation", () => {
	test("empty ruleset categorises everything to the fallback verdict", () => {
		const rules = compileRules(buildRuleSet([]));
		assert.deepStrictEqual(categoriseTransaction(buildTransaction(), rules), {
			categoryId: 999,
			ruleVersion: 7,
			rulePriority: null,
			matcherType: "fallback"
		});
	});
});

suite("tier 1: mcc", () => {
	test("matches a transaction by exact mcc", () => {
		const rules = compileRules(
			buildRuleSet([buildRule({ matcherType: "mcc", pattern: "5411" })])
		);
		assert.deepStrictEqual(
			categoriseTransaction(
				buildTransaction({ metadata: { mcc: "5411" } }),
				rules
			),
			{ categoryId: 10, ruleVersion: 7, rulePriority: 100, matcherType: "mcc" }
		);
	});

	test("lowest priority wins when two rules share an mcc, regardless of input order", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({ pattern: "5411", priority: 110, categoryId: 11 }),
				buildRule({ pattern: "5411", priority: 105, categoryId: 12 })
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({ metadata: { mcc: "5411" } }),
			rules
		);
		assert.strictEqual(verdict.categoryId, 12);
	});

	test("unknown mcc falls through", () => {
		const rules = compileRules(buildRuleSet([buildRule({ pattern: "5411" })]));
		const verdict = categoriseTransaction(
			buildTransaction({ metadata: { mcc: "9999" } }),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 2: keyword", () => {
	const uberRule = buildRule({
		matcherType: "keyword",
		pattern: "Uber",
		priority: 305,
		categoryId: 20
	});

	test("matches case-insensitively against shortDescription", () => {
		const rules = compileRules(buildRuleSet([uberRule]));
		assert.deepStrictEqual(
			categoriseTransaction(
				buildTransaction({ shortDescription: "UBER *TRIP" }),
				rules
			),
			{
				categoryId: 20,
				ruleVersion: 7,
				rulePriority: 305,
				matcherType: "keyword"
			}
		);
	});

	test("matches against longDescription when shortDescription is null", () => {
		const rules = compileRules(buildRuleSet([uberRule]));
		const verdict = categoriseTransaction(
			buildTransaction({ longDescription: "uber trip 12 aug" }),
			rules
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("lowest priority wins when two keywords both match", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "keyword",
					pattern: "delivery",
					priority: 310,
					categoryId: 21
				}),
				uberRule
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({ longDescription: "uber delivery" }),
			rules
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("applies to debit_order transactions", () => {
		const rules = compileRules(buildRuleSet([uberRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "debit_order",
				longDescription: "uber one"
			}),
			rules
		);
		assert.strictEqual(verdict.categoryId, 20);
	});

	test("is skipped for transaction types outside the keyword scope", () => {
		const rules = compileRules(buildRuleSet([uberRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "eft",
				longDescription: "uber trip"
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

// The seed's rules for a debit order to a lender, and their pinned category
// ids (database/migrations/0001_seed_categories_and_rules.sql): 10 is
// loan_repayment, 16 is recurring_payments.
const SEED_DEBIT_ORDER_RULES = [
	buildRule({
		matcherType: "keyword",
		pattern: "wesbank",
		priority: 351,
		categoryId: 10
	}),
	buildRule({
		matcherType: "source_default",
		pattern: "debit_order",
		priority: 902,
		categoryId: 16
	})
];

// The normaliser's real output, not hand-built descriptions: the keyword tier
// reads the descriptions the normaliser fills, or rule 351 never fires and
// every repayment to a lender falls through to the debit-order default.
suite("tier 2 on the debit-order normaliser's output", () => {
	test("a debit order to a lender is loan_repayment, by its keyword rule", () => {
		const transaction = normaliseTransaction(
			buildDebitOrderRecord({
				creditorName: "Wesbank",
				creditorAbbrevName: "Wesbank",
				description: "Debit order: Wesbank"
			}),
			"debit_order"
		);

		const verdict = categoriseTransaction(
			transaction,
			compileRules(buildRuleSet(SEED_DEBIT_ORDER_RULES))
		);

		assert.deepStrictEqual(verdict, {
			categoryId: 10,
			ruleVersion: 7,
			rulePriority: 351,
			matcherType: "keyword"
		});
	});

	test("a creditor no keyword names gets the debit-order default", () => {
		const transaction = normaliseTransaction(
			buildDebitOrderRecord({
				creditorName: "Acme Storage",
				creditorAbbrevName: "Acme Storage",
				description: "Debit order: Acme Storage"
			}),
			"debit_order"
		);

		const verdict = categoriseTransaction(
			transaction,
			compileRules(buildRuleSet(SEED_DEBIT_ORDER_RULES))
		);

		assert.strictEqual(verdict.rulePriority, 902);
		assert.strictEqual(verdict.matcherType, "source_default");
	});
});

suite("tier 3: source_transaction_type", () => {
	const purchaseRule = buildRule({
		matcherType: "source_transaction_type",
		pattern: "card:purchase",
		priority: 505,
		categoryId: 30
	});

	test("matches on transactionType plus metadata.operation", () => {
		const rules = compileRules(buildRuleSet([purchaseRule]));
		assert.deepStrictEqual(
			categoriseTransaction(
				buildTransaction({
					transactionType: "card",
					metadata: { operation: "purchase" }
				}),
				rules
			),
			{
				categoryId: 30,
				ruleVersion: 7,
				rulePriority: 505,
				matcherType: "source_transaction_type"
			}
		);
	});

	test("the same operation on a different transactionType does not match", () => {
		const rules = compileRules(buildRuleSet([purchaseRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "eft",
				metadata: { operation: "purchase" }
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});

	test("a non-string operation is ignored", () => {
		const rules = compileRules(buildRuleSet([purchaseRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "card",
				metadata: { operation: 42 }
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 4: source_credit_debit_indicator", () => {
	const eftCreditRule = buildRule({
		matcherType: "source_credit_debit_indicator",
		pattern: "eft:credit",
		priority: 705,
		categoryId: 50
	});

	test("matches on transactionType plus the credit/debit indicator", () => {
		const rules = compileRules(buildRuleSet([eftCreditRule]));
		assert.deepStrictEqual(
			categoriseTransaction(
				buildTransaction({
					transactionType: "eft",
					creditDebitIndicator: "credit"
				}),
				rules
			),
			{
				categoryId: 50,
				ruleVersion: 7,
				rulePriority: 705,
				matcherType: "source_credit_debit_indicator"
			}
		);
	});

	test("the same credit/debit indicator on a different transactionType does not match", () => {
		const rules = compileRules(buildRuleSet([eftCreditRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "internal_transfer",
				creditDebitIndicator: "credit"
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});

	test("the opposite credit/debit indicator on the same transactionType does not match", () => {
		const rules = compileRules(buildRuleSet([eftCreditRule]));
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "eft",
				creditDebitIndicator: "debit"
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier 5: source_default", () => {
	test("routes an otherwise unmatched transaction by its transactionType", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "source_default",
					pattern: "internal_transfer",
					priority: 905,
					categoryId: 40
				})
			])
		);
		assert.deepStrictEqual(
			categoriseTransaction(
				buildTransaction({ transactionType: "internal_transfer" }),
				rules
			),
			{
				categoryId: 40,
				ruleVersion: 7,
				rulePriority: 905,
				matcherType: "source_default"
			}
		);
	});

	test("a transactionType without a default falls through to the fallback", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "source_default",
					pattern: "card",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({ transactionType: "eft" }),
			rules
		);
		assert.strictEqual(verdict.matcherType, "fallback");
	});
});

suite("tier precedence", () => {
	test("mcc beats keyword", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({ matcherType: "mcc", pattern: "5411", categoryId: 10 }),
				buildRule({
					matcherType: "keyword",
					pattern: "spar",
					priority: 305,
					categoryId: 20
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({ metadata: { mcc: "5411" }, shortDescription: "SPAR" }),
			rules
		);
		assert.strictEqual(verdict.matcherType, "mcc");
	});

	test("keyword beats source_transaction_type", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "keyword",
					pattern: "spar",
					priority: 305,
					categoryId: 20
				}),
				buildRule({
					matcherType: "source_transaction_type",
					pattern: "card:purchase",
					priority: 505,
					categoryId: 30
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({
				shortDescription: "SPAR",
				metadata: { operation: "purchase" }
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "keyword");
	});

	test("source_transaction_type beats source_default", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "source_transaction_type",
					pattern: "card:purchase",
					priority: 505,
					categoryId: 30
				}),
				buildRule({
					matcherType: "source_default",
					pattern: "card",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({ metadata: { operation: "purchase" } }),
			rules
		);
		assert.strictEqual(verdict.matcherType, "source_transaction_type");
	});

	test("source_transaction_type beats source_credit_debit_indicator", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "source_transaction_type",
					pattern: "eft:incoming",
					priority: 505,
					categoryId: 30
				}),
				buildRule({
					matcherType: "source_credit_debit_indicator",
					pattern: "eft:credit",
					priority: 705,
					categoryId: 50
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "eft",
				creditDebitIndicator: "credit",
				metadata: { operation: "incoming" }
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "source_transaction_type");
	});

	test("source_credit_debit_indicator beats source_default", () => {
		const rules = compileRules(
			buildRuleSet([
				buildRule({
					matcherType: "source_credit_debit_indicator",
					pattern: "eft:credit",
					priority: 705,
					categoryId: 50
				}),
				buildRule({
					matcherType: "source_default",
					pattern: "eft",
					priority: 905,
					categoryId: 40
				})
			])
		);
		const verdict = categoriseTransaction(
			buildTransaction({
				transactionType: "eft",
				creditDebitIndicator: "credit"
			}),
			rules
		);
		assert.strictEqual(verdict.matcherType, "source_credit_debit_indicator");
	});
});
