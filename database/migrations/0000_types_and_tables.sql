-- Custom SQL migration file, put your code below! --

-- Isolating the application's tables in a schema to manage privileges.
CREATE SCHEMA txn_agg;

-- Readers can use the schema and read every table in it. The migrations run as
-- admin, so reads are a default privilege on every table admin creates here.
GRANT USAGE ON SCHEMA txn_agg TO txn_agg_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA txn_agg GRANT SELECT ON TABLES TO txn_agg_read;

CREATE TYPE txn_agg.transaction_type AS ENUM ('card', 'debit_order', 'eft', 'internal_transfer');
CREATE TYPE txn_agg.credit_debit_indicator AS ENUM ('credit', 'debit');
CREATE TYPE txn_agg.transaction_status AS ENUM ('completed', 'pending', 'reversed', 'failed');

CREATE TABLE txn_agg.categories (
  category_id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category      TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE txn_agg.rule_sets (
  version     int PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notes       text NOT NULL
);

CREATE TABLE txn_agg.categorization_rules (
  categorization_rule_id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ruleset_version int  NOT NULL REFERENCES txn_agg.rule_sets(version),
  priority        int  NOT NULL,
  matcher_type    text NOT NULL CHECK (matcher_type IN ('mcc','keyword','source_transaction_type','source_credit_debit_indicator','source_default')),
  pattern         text NOT NULL,
  category_id     smallint NOT NULL REFERENCES txn_agg.categories(category_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ruleset_version, priority)
);

-- The API supports crud operations and a user should be able to categorise their own transactions
CREATE TABLE txn_agg.user_category_overrides (
  user_id          uuid        NOT NULL,
  from_category_id smallint    NOT NULL REFERENCES txn_agg.categories(category_id),
  to_category_id   smallint    NOT NULL REFERENCES txn_agg.categories(category_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,                          -- soft delete: NULL = active; DELETE endpoints archive, never remove
  PRIMARY KEY (user_id, from_category_id),               -- one remap per source category per user
  CHECK (from_category_id <> to_category_id)             -- self-remap is meaningless
);

-- Single-transaction override.
CREATE TABLE txn_agg.user_transaction_overrides (
  user_id        uuid        NOT NULL,
  transaction_id uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL,   -- copied from the transaction at write time; enables cheap retention pruning
  category_id    smallint    NOT NULL REFERENCES txn_agg.categories(category_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,             -- soft delete: NULL = active; DELETE endpoints archive, never remove
  PRIMARY KEY (transaction_id, occurred_at)
  -- Deliberately not adding a FK constraint.
  -- The tables partition can be dropped independently
) PARTITION BY RANGE (occurred_at);

CREATE TABLE txn_agg.transactions (
  transaction_id            uuid NOT NULL DEFAULT uuidv7(),   -- PG18 native; DB-layer UUIDv7
  user_id       uuid        NOT NULL, -- no users table exists, the assumption is that users are controlled in their own database
  account_id    uuid        NOT NULL, -- the customer account the transaction occurred on; a user can hold several accounts.
  transaction_type txn_agg.transaction_type NOT NULL,
  external_id   text        NOT NULL,
  occurred_at   timestamptz NOT NULL, -- partition key; transaction time
  credit_debit_indicator txn_agg.credit_debit_indicator NOT NULL,
  status        txn_agg.transaction_status NOT NULL, -- every status is stored; only completed counts toward aggregates
  amount_minor  bigint      NOT NULL CHECK (amount_minor > 0),
  currency      char(3)     NOT NULL,
  long_description  text,
  short_description text, -- who we paid / who paid us: card merchant, EFT beneficiary/payer, debit-order creditor; NULL for internal_transfer (no external counterparty)
  category_id   smallint    NOT NULL REFERENCES txn_agg.categories(category_id),
  rule_version  int         NOT NULL REFERENCES txn_agg.rule_sets(version),
  rule_priority int,        -- lineage: with rule_version, names the EXACT rule that fired; NULL = engine fallback (no rule matched)
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb,
  PRIMARY KEY (transaction_id, occurred_at),
  UNIQUE (transaction_type, external_id, occurred_at), -- transaction_type and externalId must be unique, assume we have internal control
  FOREIGN KEY (rule_version, rule_priority)  -- stamped lineage must reference a real rule (skipped when rule_priority IS NULL)
    REFERENCES txn_agg.categorization_rules (ruleset_version, priority)
) PARTITION BY RANGE (occurred_at);

-- The read index stores every column the list and summary read, account_id
-- included, so a page or a summary, filtered by account or not, is answered
-- from the index alone instead of reading each row from the table.
CREATE INDEX idx_tx_user_read ON txn_agg.transactions (user_id, occurred_at DESC, transaction_id DESC)
  INCLUDE (transaction_type, credit_debit_indicator, status, amount_minor, currency, category_id, short_description, account_id);

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM partman.part_config WHERE parent_table = 'txn_agg.transactions')
  THEN
    PERFORM
       partman.create_parent(
          p_parent_table := 'txn_agg.transactions',
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
  retention = '18 month',
  retention_keep_table = false
WHERE parent_table = 'txn_agg.transactions';


DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM partman.part_config WHERE parent_table = 'txn_agg.user_transaction_overrides')
  THEN
    PERFORM
       partman.create_parent(
          p_parent_table := 'txn_agg.user_transaction_overrides',
          p_control := 'occurred_at',
          p_type := 'range',
          p_interval := '1 month',
          p_premake := 3,
          p_start_partition := (now() - interval '19 months')::text
      );
    END IF;
END $$;

UPDATE partman.part_config
SET
  infinite_time_partitions = true,
  retention = '18 month',  -- aligned with transactions by convention, not by constraint
  retention_keep_table = false
WHERE parent_table = 'txn_agg.user_transaction_overrides';


-- Write privileges, per table. Reads come from the txn_agg_read default privilege.
-- Consumers insert transaction facts; facts are never updated or deleted.
GRANT INSERT ON txn_agg.transactions TO txn_agg_write;

-- The API writes user preferences only
GRANT SELECT, INSERT, UPDATE ON txn_agg.user_transaction_overrides, txn_agg.user_category_overrides TO txn_agg_prefs_write;
