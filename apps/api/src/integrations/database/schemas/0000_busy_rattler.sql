-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."direction_type" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('card', 'loan', 'debit_order', 'eft', 'internal_transfer');--> statement-breakpoint
CREATE TABLE "transactions_p20250201" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "flyway_schema_history" (
	"installed_rank" integer NOT NULL,
	"version" varchar(50),
	"description" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"script" varchar(1000) NOT NULL,
	"checksum" integer,
	"installed_by" varchar(100) NOT NULL,
	"installed_on" timestamp DEFAULT now() NOT NULL,
	"execution_time" integer NOT NULL,
	"success" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250301" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"categorization_rule_id" integer GENERATED ALWAYS AS IDENTITY (sequence name "categorization_rules_categorization_rule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ruleset_version" integer NOT NULL,
	"priority" integer NOT NULL,
	"matcher_type" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"category_id" smallint GENERATED ALWAYS AS IDENTITY (sequence name "categories_category_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_category_overrides" (
	"user_id" uuid NOT NULL,
	"from_category_id" smallint NOT NULL,
	"to_category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_progress" (
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"last_offset" bigint NOT NULL,
	"messages_total" bigint DEFAULT 0 NOT NULL,
	"rows_inserted_total" bigint DEFAULT 0 NOT NULL,
	"duplicates_total" bigint DEFAULT 0 NOT NULL,
	"dlq_total" bigint DEFAULT 0 NOT NULL,
	"tombstones_total" bigint DEFAULT 0 NOT NULL,
	"filtered_total" bigint DEFAULT 0 NOT NULL,
	"last_occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250101" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250401" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250501" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250601" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250701" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250801" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20250901" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20251001" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20251101" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20251201" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260101" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260201" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260301" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260401" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260501" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260601" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260701" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260801" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20260901" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_p20261001" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions_default" (
	"transaction_id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"direction" "direction_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text,
	"merchant_name" text,
	"mcc" char(4),
	"category_id" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_priority" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250101" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250201" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250301" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250401" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250501" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250601" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250701" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250801" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20250901" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20251001" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20251101" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20251201" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260101" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260201" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260301" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260401" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260501" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260601" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260701" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260801" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20260901" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_p20261001" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_transaction_overrides_default" (
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions_p20250201" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250201" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250201" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250301" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250301" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250301" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_category_overrides" ADD CONSTRAINT "user_category_overrides_from_category_id_fkey" FOREIGN KEY ("from_category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_category_overrides" ADD CONSTRAINT "user_category_overrides_to_category_id_fkey" FOREIGN KEY ("to_category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250101" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250101" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250101" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250401" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250401" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250401" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250501" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250501" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250501" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250601" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250601" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250601" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250701" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250701" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250701" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250801" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250801" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250801" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250901" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250901" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20250901" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251001" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251001" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251001" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251101" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251101" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251101" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251201" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251201" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20251201" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260101" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260101" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260101" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260201" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260201" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260201" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260301" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260301" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260301" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260401" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260401" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260401" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260501" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260501" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260501" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260601" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260601" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260601" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260701" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260701" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260701" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260801" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260801" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260801" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260901" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260901" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20260901" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20261001" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20261001" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_p20261001" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_default" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_default" ADD CONSTRAINT "transactions_rule_version_fkey" FOREIGN KEY ("rule_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_default" ADD CONSTRAINT "transactions_rule_version_rule_priority_fkey" FOREIGN KEY ("rule_version","rule_priority") REFERENCES "public"."categorization_rules"("ruleset_version","priority") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250101" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250201" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250301" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250401" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250501" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250601" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250701" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250801" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20250901" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20251001" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20251101" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20251201" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260101" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260201" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260301" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260401" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260501" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260601" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260701" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260801" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20260901" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_p20261001" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_transaction_overrides_default" ADD CONSTRAINT "user_transaction_overrides_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_p20250201_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250201" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "flyway_schema_history_s_idx" ON "flyway_schema_history" USING btree ("success" bool_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250301_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250301" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250101_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250101" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250401_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250401" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250501_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250501" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250601_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250601" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250701_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250701" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250801_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250801" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20250901_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20250901" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20251001_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20251001" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20251101_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20251101" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20251201_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20251201" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260101_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260101" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260201_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260201" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260301_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260301" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260401_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260401" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260501_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260501" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260601_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260601" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260701_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260701" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260801_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260801" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20260901_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20260901" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_p20261001_user_id_occurred_at_transaction_id_s_idx" ON "transactions_p20261001" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "transactions_default_user_id_occurred_at_transaction_id_sou_idx" ON "transactions_default" USING btree ("user_id" timestamptz_ops,"occurred_at" timestamptz_ops,"transaction_id" timestamptz_ops,"source" uuid_ops,"direction" timestamptz_ops,"amount_minor" timestamptz_ops,"currency" timestamptz_ops,"category_id" timestamptz_ops,"merchant_name" timestamptz_ops);
*/