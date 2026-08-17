

CREATE TYPE source_type AS ENUM ('card', 'loan', 'debit_order', 'eft', 'internal_transfer');
CREATE TYPE direction_type AS ENUM ('debit','credit');

CREATE TABLE categories (
  category_id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
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
  matcher_type    text NOT NULL CHECK (matcher_type IN ('mcc','keyword','source_txn_type','source_default')),
  pattern         text NOT NULL,
  category_id     smallint NOT NULL REFERENCES categories(category_id),
  UNIQUE (ruleset_version, priority)
);

CREATE TABLE transactions (
  id            uuid        NOT NULL DEFAULT uuidv7(),   -- PG18 native; DB-layer UUIDv7 (brief)
  user_id       uuid        NOT NULL, -- opaque; no users table exists, the assumption is that users are controlled in their own database
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
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb,
  PRIMARY KEY (id, occurred_at),
  UNIQUE (source, external_id, occurred_at) -- Source and externalId must be unique, assume we have internal control
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_tx_user_read ON transactions (user_id, occurred_at DESC, id DESC)
  INCLUDE (source, direction, amount_minor, currency, category_id, merchant_name);

-- Admin 
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
  retention = '24 month',
  retention_keep_table = false
WHERE parent_table = 'public.transactions';

