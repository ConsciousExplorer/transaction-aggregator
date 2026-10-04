\connect txn_agg;

CREATE SCHEMA IF NOT EXISTS partman AUTHORIZATION postgres;

CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
GRANT ALL ON SCHEMA partman to admin;
GRANT ALL ON ALL TABLES IN SCHEMA partman TO admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO admin;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA partman TO admin;
GRANT ALL ON ALL PROCEDURES IN SCHEMA partman TO admin;

-- pg_cron lives in the database that holds the partitioned tables
-- (cron.database_name=txn_agg). The migrations schedule the maintenance job as
-- admin (database/migrations/0002_schedule_maintenance.sql).
CREATE EXTENSION pg_cron;
GRANT USAGE ON SCHEMA cron TO admin;

-- Per-statement timing for the Database dashboard. The library is preloaded by
-- the compose command (shared_preload_libraries); this creates its view, in
-- public, where the metrics exporter reads it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
