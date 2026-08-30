

CREATE TYPE source_type AS ENUM ('card', 'loan', 'debit_order', 'eft', 'internal_transfer');
CREATE TYPE direction_type AS ENUM ('debit','credit');

CREATE TABLE categories (
  category_id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category      TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now() 
);

CREATE TABLE rule_sets (
  version     int PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notes       text NOT NULL
);

CREATE TABLE categorization_rules (
  categorization_rule_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ruleset_version int  NOT NULL REFERENCES rule_sets(version),
  priority        int  NOT NULL,
  matcher_type    text NOT NULL CHECK (matcher_type IN ('mcc','keyword','source_transaction_type','source_default')),
  pattern         text NOT NULL,
  category_id     smallint NOT NULL REFERENCES categories(category_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ruleset_version, priority)
);

-- The API supports crud operations and a user should be able to categorize their own transactions
CREATE TABLE user_category_overrides (
  user_id          uuid        NOT NULL,
  from_category_id smallint    NOT NULL REFERENCES categories(category_id),
  to_category_id   smallint    NOT NULL REFERENCES categories(category_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,                          -- soft delete (D33): NULL = active; DELETE endpoints archive, never remove
  PRIMARY KEY (user_id, from_category_id),               -- one remap per source category per user
  CHECK (from_category_id <> to_category_id)             -- self-remap is meaningless
);

-- Single-transaction override: the precise correction; beats the remap at read time (SPEC §2.5).
CREATE TABLE user_transaction_overrides (
  user_id        uuid        NOT NULL,
  transaction_id uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL,   -- copied from the transaction at write time; enables cheap retention pruning (D28)
  category_id    smallint    NOT NULL REFERENCES categories(category_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,             -- soft delete (D33): NULL = active; DELETE endpoints archive, never remove
  PRIMARY KEY (transaction_id, occurred_at)
  -- Deliberately not adding a FK constraint. 
  -- The tables partition can be dropped independently
) PARTITION BY RANGE (occurred_at);

CREATE TABLE transactions (
  transaction_id            uuid NOT NULL DEFAULT uuidv7(),   -- PG18 native; DB-layer UUIDv7 (brief)
  user_id       uuid        NOT NULL, -- opaque; no users table exists, the assumption is that users are controlled in their own database
  account_id    uuid        NOT NULL, -- the customer account the transaction occurred on; a user can hold several accounts. Opaque like user_id: accounts live in their own system
  source        source_type NOT NULL,
  external_id   text        NOT NULL,
  occurred_at   timestamptz NOT NULL, -- partition key; transaction time
  posted_at     timestamptz,
  direction     direction_type NOT NULL,
  amount_minor  bigint      NOT NULL CHECK (amount_minor > 0),
  currency      char(3)     NOT NULL,
  description   text,
  merchant_name text,
  mcc           char(4)     CHECK (mcc ~ '^[0-9]{4}$'),  -- ISO 18245; leading zeros are real
  category_id   smallint    NOT NULL REFERENCES categories(category_id),
  rule_version  int         NOT NULL REFERENCES rule_sets(version),
  rule_priority int,        -- lineage: with rule_version, names the EXACT rule that fired; NULL = engine fallback (no rule matched)
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb,
  PRIMARY KEY (transaction_id, occurred_at),
  UNIQUE (source, external_id, occurred_at), -- Source and externalId must be unique, assume we have internal control
  FOREIGN KEY (rule_version, rule_priority)  -- stamped lineage must reference a real rule (skipped when rule_priority IS NULL)
    REFERENCES categorization_rules (ruleset_version, priority)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_tx_user_read ON transactions (user_id, occurred_at DESC, transaction_id DESC)
  INCLUDE (source, direction, amount_minor, currency, category_id, merchant_name);

-- Admin 
-- This table is for long term metrics. OTEL will typically not store months worth of data
CREATE TABLE ingest_progress (
  topic               text   NOT NULL,
  partition           int    NOT NULL,
  last_offset         bigint NOT NULL,
  messages_total      bigint NOT NULL DEFAULT 0,
  rows_inserted_total bigint NOT NULL DEFAULT 0,
  duplicates_total    bigint NOT NULL DEFAULT 0,
  dlq_total           bigint NOT NULL DEFAULT 0,
  tombstones_total    bigint NOT NULL DEFAULT 0,
  filtered_total      bigint NOT NULL DEFAULT 0,
  last_occurred_at    timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic, partition)
);

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM partman.part_config WHERE parent_table = 'public.transactions')
  THEN 
    PERFORM 
       partman.create_parent(
          p_parent_table := 'public.transactions',
          p_control := 'occurred_at',
          p_type := 'range',
          p_interval := '1 month',
          p_premake := 2,
          p_start_partition := (now() - interval '19 months')::text
      );
    END IF;
END $$;

UPDATE partman.part_config
SET
  infinite_time_partitions = true,
  retention = '18 month',  -- the brief's number (SPEC §2.3); v1 shipped 24 by drift
  retention_keep_table = false
WHERE parent_table = 'public.transactions';

-- overrides partitioned on the same calendar; no FK → drops need no cross-table ordering
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM partman.part_config WHERE parent_table = 'public.user_transaction_overrides')
  THEN
    PERFORM
       partman.create_parent(
          p_parent_table := 'public.user_transaction_overrides',
          p_control := 'occurred_at',
          p_type := 'range',
          p_interval := '1 month',
          p_premake := 2,
          p_start_partition := (now() - interval '19 months')::text
      );
    END IF;
END $$;

UPDATE partman.part_config
SET
  infinite_time_partitions = true,
  retention = '18 month',  -- aligned with transactions by convention, not by constraint
  retention_keep_table = false
WHERE parent_table = 'public.user_transaction_overrides';

