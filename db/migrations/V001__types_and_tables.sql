

CREATE TYPE source_type AS ENUM ('card','loan','transfer', 'airtime');
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
    occured_at TIMESTAMPTZ NOT NULL, -- Partition key, each transaction should have a time
    posted_at TIMESTAMPTZ,
    direction direction_type NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    description TEXT,
    merchant_name TEXT,
    mcc SMALLINT,
    category_id SMALLINT NOT NULL REFERENCES categories(category_id),
    rule_version INT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB,
    PRIMARY KEY (id, occured_at),
    UNIQUE (source, external_id, occured_at)
) PARTITION BY RANGE (occured_at);

