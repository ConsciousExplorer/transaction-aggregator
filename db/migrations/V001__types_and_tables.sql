

CREATE TYPE source_type AS ENUM ('card', 'loan', 'debit_order', 'eft', 'internal_transfer');
CREATE TYPE direction_type AS ENUM ('debit','credit');

CREATE TABLE categories (
  category_id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- ~20 system rows, seeded
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE categorization_rules (
  categorization_rule_id INT PRIMARY KEY, version INT NOT NULL, priority INT NOT NULL,
  matcher_type TEXT NOT NULL CHECK (matcher_type IN
    ('mcc','keyword','source_txn_type','source_default')),
  pattern TEXT NOT NULL,
  category_id SMALLINT NOT NULL REFERENCES categories(category_id),
  active bool NOT NULL DEFAULT true
);

CREATE TABLE transactions (
    id  UUID NOT NULL DEFAULT uuidv7(),
    user_id UUID NOT NULL,
    source source_type NOT NULL,
    external_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL, -- Partition key, each transaction should have a time
    posted_at TIMESTAMPTZ,
    direction direction_type NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    description TEXT,
    merchant_name TEXT,
    mcc CHAR(4) CHECK (mcc ~ '^[0-9]{4}$'), -- ISO 18245: 4-digit CODE, not a number — leading zeros are real (0742)
    category_id SMALLINT NOT NULL REFERENCES categories(category_id),
    rule_version INT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    PRIMARY KEY (id, occurred_at),
    UNIQUE (source, external_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_tx_user_read ON transactions (user_id, occurred_at DESC, id DESC)
  INCLUDE (source, direction, amount_minor, currency, category_id, merchant_name);

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
          p_premake := 2
      );
    END IF;
END $$;

UPDATE partman.part_config 
SET 
  infinite_time_partitions = true,
  retention = '24 month',
  retention_keep_table = false
WHERE parent_table = 'public.transactions';

