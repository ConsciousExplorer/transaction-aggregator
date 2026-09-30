\connect txn_agg;

CREATE SCHEMA IF NOT EXISTS partman AUTHORIZATION postgres;

CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
GRANT ALL ON SCHEMA partman to admin;
GRANT ALL ON ALL TABLES IN SCHEMA partman TO admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO admin;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA partman TO admin;
GRANT ALL ON ALL PROCEDURES IN SCHEMA partman TO admin;

-- pg_cron lives in the database that holds the partitioned tables
-- (cron.database_name=txn_agg). Flyway schedules the maintenance job as admin.
CREATE EXTENSION pg_cron;
GRANT USAGE ON SCHEMA cron TO admin;
