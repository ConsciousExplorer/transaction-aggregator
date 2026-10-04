-- Group roles (NOLOGIN) that carry the privileges, and login roles that inherit them.
-- Privileges are never granted to a login role directly: grant the login role a
-- group role instead.
--   txn_agg_read        SELECT on every table
--   txn_agg_write       inserts transaction facts (the consumers)
--   txn_agg_prefs_write writes the two user override tables (the API)
--   txn_agg_monitor     reads Postgres's statistics, never table data (the metrics exporter)
-- The per-table write grants live in the migration, next to the tables
-- (database/migrations/0000_types_and_tables.sql).
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

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'txn_agg_monitor') THEN
        CREATE ROLE txn_agg_monitor NOLOGIN;
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

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grafana_read') THEN
        CREATE ROLE grafana_read LOGIN PASSWORD 'grafana_read_password' CONNECTION LIMIT 5;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'postgres_exporter') THEN
        CREATE ROLE postgres_exporter LOGIN PASSWORD 'postgres_exporter_password' CONNECTION LIMIT 2;
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

-- Grafana's Postgres datasource gets its own login, so dashboard load shows up
-- separately in pg_stat_activity and stays bounded: at most 5 connections, and
-- a runaway panel query is cancelled after 5 s instead of competing with the
-- consumers' inserts.
GRANT txn_agg_read TO grafana_read;
ALTER ROLE grafana_read SET statement_timeout = '5s';

-- The metrics exporter reads Postgres's own statistics through pg_monitor: every
-- pg_stat_* view, pg_stat_statements with its query text, and the settings. It
-- is not a member of txn_agg_read, so it cannot read a single row of data. Its
-- own login shows up separately in pg_stat_activity, and 2 connections with a
-- 5 s timeout keep a slow scrape from competing with the consumers' inserts.
GRANT pg_monitor TO txn_agg_monitor;
GRANT txn_agg_monitor TO postgres_exporter;
ALTER ROLE postgres_exporter SET statement_timeout = '5s';

\connect txn_agg;

-- Only members of the read role may connect / see the schema.
REVOKE ALL ON DATABASE txn_agg FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE txn_agg TO txn_agg_read;
GRANT USAGE ON SCHEMA public TO txn_agg_read;

-- The monitor connects to read the statistics. USAGE on public is for the
-- pg_stat_statements view (02-config.sql); it grants no SELECT on any table.
GRANT CONNECT ON DATABASE txn_agg TO txn_agg_monitor;
GRANT USAGE ON SCHEMA public TO txn_agg_monitor;

-- Migration-created tables are owned by admin, so reads are granted as a default
-- privilege on anything admin creates later.
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA public
    GRANT SELECT ON TABLES TO txn_agg_read;
