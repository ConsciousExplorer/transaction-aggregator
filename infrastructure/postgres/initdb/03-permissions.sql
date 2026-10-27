-- Group roles (NOLOGIN) that carry the privileges, and login roles that inherit them.
-- Privileges are never granted to a login role directly: grant the login role a
-- group role instead.
--   txn_agg_read        SELECT on every table in the txn_agg schema
--   txn_agg_write       inserts transaction facts (the consumers)
--   txn_agg_prefs_write writes the two user override tables (the API)
--   txn_agg_monitor     reads Postgres's statistics and the monitoring views,
--                       never table data (the metrics exporter and Grafana)
-- The migrations create the txn_agg and monitoring schemas and grant on them
-- and on everything inside them (database/migrations/0000_types_and_tables.sql,
-- 0003_monitoring.sql). This file holds what lives outside a schema: the roles,
-- their memberships and the database.
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

-- Grafana's Database dashboard reads the monitoring views too. Through
-- txn_agg_monitor it holds pg_monitor, so the statement view shows every role's
-- query text, not <insufficient privilege>.
GRANT txn_agg_monitor TO grafana_read;

-- The metrics exporter reads Postgres's own statistics through pg_monitor: every
-- pg_stat_* view, pg_stat_statements with its query text, and the settings. It
-- is not a member of txn_agg_read, so it cannot read a single row of data. Its
-- own login shows up separately in pg_stat_activity, and 2 connections with a
-- 5 s timeout keep a slow scrape from competing with the consumers' inserts.
GRANT pg_monitor TO txn_agg_monitor;
GRANT txn_agg_monitor TO postgres_exporter;
ALTER ROLE postgres_exporter SET statement_timeout = '5s';

\connect txn_agg;

-- Only members of the read and monitor roles may connect. public holds only what
-- extensions install there, so the readers get no USAGE on it.
REVOKE ALL ON DATABASE txn_agg FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE txn_agg TO txn_agg_read;

-- The monitor connects to read the statistics. USAGE on public is for the
-- pg_stat_statements view (02-config.sql), which the exporter reads directly.
GRANT CONNECT ON DATABASE txn_agg TO txn_agg_monitor;
GRANT USAGE ON SCHEMA public TO txn_agg_monitor;
