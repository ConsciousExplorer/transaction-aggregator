// Hand-maintained mirror of database/migrations, which is the schema of
// record. `npm run drizzle:pull-schema` writes a draft of this file and
// partitioned.ts that has to be reconciled by hand: pull drops the primary
// keys and unique constraints, and the parents' CHECKs.
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgSchema,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
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
	version: integer().primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	notes: text().notNull()
});

export const categorizationRules = txnAgg.table(
	"categorization_rules",
	{
		categorizationRuleId: integer("categorization_rule_id")
			.generatedAlwaysAsIdentity({
				name: "categorization_rules_categorization_rule_id_seq",
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			})
			.primaryKey(),
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
		unique("categorization_rules_ruleset_version_priority_key").on(
			table.rulesetVersion,
			table.priority
		),
		foreignKey({
			columns: [table.rulesetVersion],
			foreignColumns: [ruleSets.version],
			name: "categorization_rules_ruleset_version_fkey"
		}),
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "categorization_rules_category_id_fkey"
		}),
		check(
			"categorization_rules_matcher_type_check",
			sql`matcher_type = ANY (ARRAY['mcc'::text, 'keyword'::text, 'source_transaction_type'::text, 'source_credit_debit_indicator'::text, 'source_default'::text])`
		)
	]
);

export const categories = txnAgg.table("categories", {
	categoryId: smallint("category_id")
		.generatedAlwaysAsIdentity({
			name: "categories_category_id_seq",
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: 32767,
			cache: 1
		})
		.primaryKey(),
	category: text().notNull().unique("categories_category_key"),
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
		// One remap per source category per user
		primaryKey({
			columns: [table.userId, table.fromCategoryId],
			name: "user_category_overrides_pkey"
		}),
		foreignKey({
			columns: [table.fromCategoryId],
			foreignColumns: [categories.categoryId],
			name: "user_category_overrides_from_category_id_fkey"
		}),
		foreignKey({
			columns: [table.toCategoryId],
			foreignColumns: [categories.categoryId],
			name: "user_category_overrides_to_category_id_fkey"
		}),
		check(
			"user_category_overrides_check",
			sql`from_category_id <> to_category_id`
		)
	]
);
