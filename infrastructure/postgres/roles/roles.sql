-- Who exists: the group roles, the logins and who may connect.
-- Kept with the infrastructure because nothing here names a table: this file
-- changes when someone needs access, and only the superuser may create roles.
-- What each group role may do on the tables is in database/grants/grants.sql.
-- Safe to re-run (make roles).


-- Group roles: carry the privileges, can't log in

SELECT 'CREATE ROLE txn_agg_read NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'txn_agg_read') \gexec

SELECT 'CREATE ROLE txn_agg_write NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'txn_agg_write') \gexec

SELECT 'CREATE ROLE txn_agg_prefs_write NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'txn_agg_prefs_write') \gexec

SELECT 'CREATE ROLE txn_agg_monitor NOLOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'txn_agg_monitor') \gexec

GRANT txn_agg_read TO txn_agg_write;
GRANT pg_monitor TO txn_agg_monitor;


-- Who may connect: only readers and the monitor

REVOKE ALL ON DATABASE txn_agg FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE txn_agg TO txn_agg_read;
GRANT CONNECT ON DATABASE txn_agg TO txn_agg_monitor;
-- pg_stat_statements lives in public
GRANT USAGE ON SCHEMA public TO txn_agg_monitor;


-- Logins: password from the secrets folder, then memberships

-- Consumers
\set kafka_consumer_password `cat "$SECRET_DIR/consumer_database_password"`
SELECT 'CREATE ROLE kafka_consumer LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kafka_consumer') \gexec
ALTER ROLE kafka_consumer PASSWORD :'kafka_consumer_password';
GRANT txn_agg_write TO kafka_consumer;

-- API
\set api_write_password `cat "$SECRET_DIR/api_write_password"`
SELECT 'CREATE ROLE api_write LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'api_write') \gexec
ALTER ROLE api_write PASSWORD :'api_write_password';
GRANT txn_agg_read TO api_write;
GRANT txn_agg_prefs_write TO api_write;

-- Read-only tooling (drizzle-kit pull and studio)
\set api_read_password `cat "$SECRET_DIR/api_read_password"`
SELECT 'CREATE ROLE api_read LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'api_read') \gexec
ALTER ROLE api_read PASSWORD :'api_read_password';
GRANT txn_agg_read TO api_read;

-- Grafana: capped so a dashboard can't compete with the consumers' inserts
\set grafana_read_password `cat "$SECRET_DIR/grafana_read_password"`
SELECT 'CREATE ROLE grafana_read LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_read') \gexec
ALTER ROLE grafana_read PASSWORD :'grafana_read_password' CONNECTION LIMIT 5;
ALTER ROLE grafana_read SET statement_timeout = '5s';
GRANT txn_agg_read TO grafana_read;
GRANT txn_agg_monitor TO grafana_read;

-- Metrics exporter: statistics only, capped like Grafana
\set postgres_exporter_password `cat "$SECRET_DIR/postgres_exporter_password"`
SELECT 'CREATE ROLE postgres_exporter LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres_exporter') \gexec
ALTER ROLE postgres_exporter PASSWORD :'postgres_exporter_password' CONNECTION LIMIT 2;
ALTER ROLE postgres_exporter SET statement_timeout = '5s';
GRANT txn_agg_monitor TO postgres_exporter;
