import { sql } from "drizzle-orm";
import {
	bigint,
	char,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	uuid
} from "drizzle-orm/pg-core";
import { directionType, transactionType } from "./schema.ts";

export const transactions = pgTable(
	"transactions",
	{
		transactionId: uuid("transaction_id").default(sql`uuidv7()`).notNull(),
		userId: uuid("user_id").notNull(),
		accountId: uuid("account_id").notNull(),
		transactionType: transactionType().notNull(),
		externalId: text("external_id").notNull(),
		occurredAt: timestamp("occurred_at", {
			withTimezone: true,
			mode: "string"
		}).notNull(),
		direction: directionType().notNull(),
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
	(t) => [primaryKey({ columns: [t.occurredAt, t.transactionId] })]
);

export const userTransactionOverrides = pgTable(
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
	(t) => [primaryKey({ columns: [t.transactionId, t.occurredAt] })]
);
