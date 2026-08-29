import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
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
export const sourceType = pgEnum("source_type", [
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
		categoryId: smallint("category_id").notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "categorization_rules_category_id_fkey"
		}),
		foreignKey({
			columns: [table.rulesetVersion],
			foreignColumns: [ruleSets.version],
			name: "categorization_rules_ruleset_version_fkey"
		})
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
	name: text().notNull()
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
			.notNull()
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

export const ingestProgress = pgTable("ingest_progress", {
	topic: text().notNull(),
	partition: integer().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastOffset: bigint("last_offset", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messagesTotal: bigint("messages_total", { mode: "number" })
		.default(0)
		.notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowsInsertedTotal: bigint("rows_inserted_total", { mode: "number" })
		.default(0)
		.notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	duplicatesTotal: bigint("duplicates_total", { mode: "number" })
		.default(0)
		.notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dlqTotal: bigint("dlq_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tombstonesTotal: bigint("tombstones_total", { mode: "number" })
		.default(0)
		.notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	filteredTotal: bigint("filtered_total", { mode: "number" })
		.default(0)
		.notNull(),
	lastOccurredAt: timestamp("last_occurred_at", {
		withTimezone: true,
		mode: "string"
	}),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
		.defaultNow()
		.notNull()
});
