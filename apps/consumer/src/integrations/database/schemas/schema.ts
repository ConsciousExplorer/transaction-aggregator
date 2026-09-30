import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	smallint,
	text,
	timestamp,
	uuid,
	varchar
} from "drizzle-orm/pg-core";

export const directionType = pgEnum("direction_type", ["debit", "credit"]);
export const transactionStatus = pgEnum("transaction_status", [
	"completed",
	"pending",
	"reversed",
	"failed"
]);
export const transactionType = pgEnum("transaction_type", [
	"card",
	"loan",
	"debit_order",
	"eft",
	"internal_transfer"
]);

export const flywaySchemaHistory = pgTable(
	"flyway_schema_history",
	{
		installedRank: integer("installed_rank").notNull(),
		version: varchar({ length: 50 }),
		description: varchar({ length: 200 }).notNull(),
		type: varchar({ length: 20 }).notNull(),
		script: varchar({ length: 1000 }).notNull(),
		checksum: integer(),
		installedBy: varchar("installed_by", { length: 100 }).notNull(),
		installedOn: timestamp("installed_on", { mode: "string" })
			.defaultNow()
			.notNull(),
		executionTime: integer("execution_time").notNull(),
		success: boolean().notNull()
	},
	(table) => [
		index("flyway_schema_history_s_idx").using(
			"btree",
			table.success.asc().nullsLast().op("bool_ops")
		)
	]
);

export const ruleSets = pgTable("rule_sets", {
	version: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull(),
	notes: text().notNull()
});

export const categorizationRules = pgTable(
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
		}),
		check(
			"categorization_rules_matcher_type_check",
			sql`matcher_type = ANY (ARRAY['mcc'::text, 'keyword'::text, 'source_transaction_type'::text, 'source_direction'::text, 'source_default'::text])`
		)
	]
);

export const categories = pgTable("categories", {
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

export const userCategoryOverrides = pgTable(
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
		}),
		check(
			"user_category_overrides_check",
			sql`from_category_id <> to_category_id`
		)
	]
);
