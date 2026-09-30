-- Group roles (NOLOGIN) that carry the privileges, and login roles that inherit them.
-- Privileges are never granted to a login role directly: grant the login role a
-- group role instead.
--   txn_agg_read        SELECT on every table
--   txn_agg_write       inserts transaction facts (the consumers)
--   txn_agg_prefs_write writes the two user override tables (the API)
-- The per-table write grants live in the Flyway migration, next to the tables.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_read') THEN
        CREATE ROLE txn_agg_read NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_write') THEN
        CREATE ROLE txn_agg_write NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_prefs_write') THEN
        CREATE ROLE txn_agg_prefs_write NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'kafka_consumer') THEN
        CREATE ROLE kafka_consumer LOGIN PASSWORD 'kafka_consumer_password';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'api_write') THEN
        CREATE ROLE api_write LOGIN PASSWORD 'api_write_password';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'api_read') THEN
        CREATE ROLE api_read LOGIN PASSWORD 'api_read_password';
    END IF;
END
$$;

-- Writers can do everything readers can.
GRANT txn_agg_read TO txn_agg_write;
GRANT txn_agg_read TO api_read;
GRANT txn_agg_read TO api_write;

-- The Kafka consumer writes transaction facts.
GRANT txn_agg_write TO kafka_consumer;

-- The API writes user preferences only; it cannot write transaction facts.
GRANT txn_agg_prefs_write TO api_write;

\connect txn_agg;

-- Only members of the read role may connect / see the schema.
REVOKE ALL ON DATABASE txn_agg FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE txn_agg TO txn_agg_read;
GRANT USAGE ON SCHEMA public TO txn_agg_read;

-- Flyway-created tables are owned by admin, so reads are granted as a default
-- privilege on anything admin creates later.
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
    GRANT SELECT ON TABLES TO txn_agg_read;
