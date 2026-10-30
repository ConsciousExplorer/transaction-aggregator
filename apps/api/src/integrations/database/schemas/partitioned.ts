// The partitioned parent tables, hand-maintained as a mirror of
// database/migrations. `npm run drizzle:pull-schema` writes a draft of this
// file from the *_default partitions, which has to be reconciled by hand:
// pull drops the primary keys and the CHECKs, and it can't see the INCLUDE
// columns of idx_tx_user_read.
import { sql } from "drizzle-orm";
import {
	bigint,
	char,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uuid
} from "drizzle-orm/pg-core";
import {
	categories,
	categorizationRules,
	creditDebitIndicator,
	ruleSets,
	transactionStatus,
	transactionType,
	txnAgg
} from "./schema.ts";

export const transactions = txnAgg.table(
	"transactions",
	{
		transactionId: uuid("transaction_id").default(sql`uuidv7()`).notNull(),
		userId: uuid("user_id").notNull(),
		accountId: uuid("account_id").notNull(),
		transactionType: transactionType("transaction_type").notNull(),
		externalId: text("external_id").notNull(),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string"
		}).notNull(),
		creditDebitIndicator: creditDebitIndicator(
			"credit_debit_indicator"
		).notNull(),
		status: transactionStatus().notNull(),
		// You can use { mode: "bigint" } if numbers are exceeding js number limitations
		amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
		currency: char({ length: 3 }).notNull(),
		longDescription: text("long_description"),
		shortDescription: text("short_description"),
		categoryId: smallint("category_id").notNull(),
		ruleVersion: integer("rule_version").notNull(),
		rulePriority: integer("rule_priority"),
		ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		metadata: jsonb()
	},
	(table) => [
		// The partition key is part of every key on a partitioned table
		primaryKey({
			columns: [table.transactionId, table.occurredAt],
			name: "transactions_pkey"
		}),
		// The consumer's ON CONFLICT target: the same record sent twice is skipped
		unique("transactions_transaction_type_external_id_occurred_at_key").on(
			table.transactionType,
			table.externalId,
			table.occurredAt
		),
		// The covering read index. Postgres also INCLUDEs transaction_type,
		// credit_debit_indicator, status, amount_minor, currency, category_id,
		// short_description and account_id, which drizzle can't express; the
		// migration has the full definition.
		index("idx_tx_user_read").using(
			"btree",
			table.userId.asc(),
			table.occurredAt.desc(),
			table.transactionId.desc()
		),
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
			foreignColumns: [
				categorizationRules.rulesetVersion,
				categorizationRules.priority
			],
			name: "transactions_rule_version_rule_priority_fkey"
		}),
		check("transactions_amount_minor_check", sql`amount_minor > 0`)
	]
);

export const userTransactionOverrides = txnAgg.table(
	"user_transaction_overrides",
	{
		userId: uuid("user_id").notNull(),
		transactionId: uuid("transaction_id").notNull(),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string"
		}).notNull(),
		categoryId: smallint("category_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" })
	},
	(table) => [
		// The API's ON CONFLICT target: one override per transaction
		primaryKey({
			columns: [table.transactionId, table.occurredAt],
			name: "user_transaction_overrides_pkey"
		}),
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.categoryId],
			name: "user_transaction_overrides_category_id_fkey"
		})
	]
);
