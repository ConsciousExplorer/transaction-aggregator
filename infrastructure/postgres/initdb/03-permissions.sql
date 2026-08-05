-- Group roles (NOLOGIN) that carry the privileges, and login roles that inherit them.
-- Privileges are never granted to a login role directly: grant the login role
-- txn_agg_read or txn_agg_write instead.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_read') THEN
        CREATE ROLE txn_agg_read NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_write') THEN
        CREATE ROLE txn_agg_write NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'kafka_consumer') THEN
        CREATE ROLE kafka_consumer LOGIN PASSWORD 'kafka_consumer_password';
    END IF;
END
$$;

-- Writers can do everything readers can.
GRANT txn_agg_read TO txn_agg_write;

-- The Kafka consumer writes to the database.
GRANT txn_agg_write TO kafka_consumer;

\connect txn_agg;

-- Only members of the two group roles may connect / see the schema.
REVOKE ALL ON DATABASE txn_agg FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE txn_agg TO txn_agg_read;
GRANT USAGE ON SCHEMA public TO txn_agg_read;

-- Current objects. Flyway-created tables are owned by admin, so the default
-- privileges below are what actually matter day to day; these two statements
-- cover anything that already exists when this script runs.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO txn_agg_read;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO txn_agg_write;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO txn_agg_write;

-- Future objects created by admin (Flyway).
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
    GRANT SELECT ON TABLES TO txn_agg_read;

ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
    GRANT INSERT, UPDATE, DELETE ON TABLES TO txn_agg_write;

-- Needed for BIGSERIAL / IDENTITY columns.
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO txn_agg_write;
