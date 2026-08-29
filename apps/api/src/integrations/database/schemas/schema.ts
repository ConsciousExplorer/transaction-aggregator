import { pgTable, index, integer, varchar, timestamp, boolean, text, foreignKey, smallint, uuid, bigint, char, jsonb, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const directionType = pgEnum("direction_type", ['debit', 'credit'])
export const sourceType = pgEnum("source_type", ['card', 'loan', 'debit_order', 'eft', 'internal_transfer'])


export const flywaySchemaHistory = pgTable("flyway_schema_history", {
	installedRank: integer("installed_rank").notNull(),
	version: varchar({ length: 50 }),
	description: varchar({ length: 200 }).notNull(),
	type: varchar({ length: 20 }).notNull(),
	script: varchar({ length: 1000 }).notNull(),
	checksum: integer(),
	installedBy: varchar("installed_by", { length: 100 }).notNull(),
	installedOn: timestamp("installed_on", { mode: 'string' }).defaultNow().notNull(),
	executionTime: integer("execution_time").notNull(),
	success: boolean().notNull(),
}, (table) => [
	index("flyway_schema_history_s_idx").using("btree", table.success.asc().nullsLast().op("bool_ops")),
]);

export const ruleSets = pgTable("rule_sets", {
	version: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	notes: text().notNull(),
});

export const categorizationRules = pgTable("categorization_rules", {
	categorizationRuleId: integer("categorization_rule_id").generatedAlwaysAsIdentity({ name: "categorization_rules_categorization_rule_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	rulesetVersion: integer("ruleset_version").notNull(),
	priority: integer().notNull(),
	matcherType: text("matcher_type").notNull(),
	pattern: text().notNull(),
	categoryId: smallint("category_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "categorization_rules_category_id_fkey"
		}),
	foreignKey({
			columns: [table.rulesetVersion],
			foreignColumns: [ruleSets.version],
			name: "categorization_rules_ruleset_version_fkey"
		}),
]);

export const categories = pgTable("categories", {
	categoryId: smallint("category_id").generatedAlwaysAsIdentity({ name: "categories_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 32767, cache: 1 }),
	name: text().notNull(),
});

export const userCategoryOverrides = pgTable("user_category_overrides", {
	userId: uuid("user_id").notNull(),
	fromCategoryId: smallint("from_category_id").notNull(),
	toCategoryId: smallint("to_category_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
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
]);

export const ingestProgress = pgTable("ingest_progress", {
	topic: text().notNull(),
	partition: integer().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastOffset: bigint("last_offset", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	messagesTotal: bigint("messages_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rowsInsertedTotal: bigint("rows_inserted_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	duplicatesTotal: bigint("duplicates_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dlqTotal: bigint("dlq_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tombstonesTotal: bigint("tombstones_total", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	filteredTotal: bigint("filtered_total", { mode: "number" }).default(0).notNull(),
	lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const transactionsDefault = pgTable("transactions_default", {
	transactionId: uuid("transaction_id").default(sql`uuidv7()`).notNull(),
	userId: uuid("user_id").notNull(),
	accountId: uuid("account_id").notNull(),
	source: sourceType().notNull(),
	externalId: text("external_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	postedAt: timestamp("posted_at", { withTimezone: true, mode: 'string' }),
	direction: directionType().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	description: text(),
	merchantName: text("merchant_name"),
	mcc: char({ length: 4 }),
	categoryId: smallint("category_id").notNull(),
	ruleVersion: integer("rule_version").notNull(),
	rulePriority: integer("rule_priority"),
	ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb(),
}, (table) => [
	index("transactions_default_user_id_occurred_at_transaction_id_sou_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops"), table.transactionId.desc().nullsFirst().op("timestamptz_ops"), table.source.asc().nullsLast().op("uuid_ops"), table.direction.asc().nullsLast().op("timestamptz_ops"), table.amountMinor.asc().nullsLast().op("timestamptz_ops"), table.currency.asc().nullsLast().op("timestamptz_ops"), table.categoryId.asc().nullsLast().op("timestamptz_ops"), table.merchantName.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "transactions_category_id_fkey"
		}),
	foreignKey({
			columns: [table.ruleVersion],
			foreignColumns: [ruleSets.version],
			name: "transactions_rule_version_fkey"
		}),
	foreignKey({
			columns: [table.ruleVersion, table.rulePriority],
			foreignColumns: [categorizationRules.rulesetVersion, categorizationRules.priority],
			name: "transactions_rule_version_rule_priority_fkey"
		}),
]);

export const userTransactionOverridesDefault = pgTable("user_transaction_overrides_default", {
	userId: uuid("user_id").notNull(),
	transactionId: uuid("transaction_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).notNull(),
	categoryId: smallint("category_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "user_transaction_overrides_category_id_fkey"
		}),
]);
