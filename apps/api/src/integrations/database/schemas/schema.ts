import {
	foreignKey,
	integer,
	pgSchema,
	smallint,
	text,
	timestamp,
	uuid
} from "drizzle-orm/pg-core";

export const txnAgg = pgSchema("txn_agg");
export const creditDebitIndicator = txnAgg.enum("credit_debit_indicator", [
	"credit",
	"debit"
]);
export const transactionStatus = txnAgg.enum("transaction_status", [
	"completed",
	"pending",
	"reversed",
	"failed"
]);
export const transactionType = txnAgg.enum("transaction_type", [
	"card",
	"debit_order",
	"eft",
	"internal_transfer"
]);

export const ruleSets = txnAgg.table("rule_sets", {
	version: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	notes: text().notNull()
});

export const categorizationRules = txnAgg.table(
	"categorization_rules",
	{
		categorizationRuleId: integer(
			"categorization_rule_id"
		).generatedAlwaysAsIdentity({
			name: "categorization_rules_categorization_rule_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: 2147483647,
			cache: 1
		}),
		rulesetVersion: integer("ruleset_version").notNull(),
		priority: integer().notNull(),
		matcherType: text("matcher_type").notNull(),
		pattern: text().notNull(),
		categoryId: smallint("category_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.rulesetVersion],
			foreignColumns: [ruleSets.version],
			name: "categorization_rules_ruleset_version_fkey"
		}),
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "categorization_rules_category_id_fkey"
		})
	]
);

export const categories = txnAgg.table("categories", {
	categoryId: smallint("category_id").generatedAlwaysAsIdentity({
		name: "categories_category_id_seq",
		startWith: 1,
		increment: 1,
		minValue: 1,
		maxValue: 32767,
		cache: 1
	}),
	category: text().notNull(),
	label: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull()
});

export const userCategoryOverrides = txnAgg.table(
	"user_category_overrides",
	{
		userId: uuid("user_id").notNull(),
		fromCategoryId: smallint("from_category_id").notNull(),
		toCategoryId: smallint("to_category_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" })
	},
	(table) => [
		foreignKey({
			columns: [table.fromCategoryId],
			foreignColumns: [categories.categoryId],
			name: "user_category_overrides_from_category_id_fkey"
		}),
		foreignKey({
			columns: [table.toCategoryId],
			foreignColumns: [categories.categoryId],
			name: "user_category_overrides_to_category_id_fkey"
		})
	]
);
