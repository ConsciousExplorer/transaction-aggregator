-- Custom SQL migration file, put your code below! --

-- Views for the Grafana Database dashboard: has partition maintenance run, are
-- the partitions where partman's config says, how big is each table and how is
-- it read, and what each role's SQL costs. They read Postgres's catalogs and
-- statistics, partman's config and pg_cron's run history, never a row of table
-- data, so they get their own schema and only the statistics role,
-- txn_agg_monitor, can use them. grafana_read is a member. The apps pull their
-- drizzle schema from txn_agg only, so these views never reach the apps.
CREATE SCHEMA monitoring;
GRANT USAGE ON SCHEMA monitoring TO txn_agg_monitor;

-- pg_cron shows a role only the jobs it scheduled: its row security compares
-- each row's username with current_user. The migrations schedule the jobs as
-- admin, so the history is read through this SECURITY DEFINER function, which
-- runs as admin. A plain view would not do: it reads the tables with its
-- owner's privileges, but current_user stays the caller, so the policy would
-- hide every row. Every job comes back with each of its runs, and a job that
-- has never run comes back once, with no run.
CREATE FUNCTION monitoring.read_cron_job_runs()
RETURNS TABLE (job_name text, schedule text, started_at timestamptz, finished_at timestamptz, status text, message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT job.jobname, job.schedule, run.start_time, run.end_time, run.status, run.return_message
    FROM cron.job job
    LEFT JOIN cron.job_run_details run ON run.jobid = job.jobid
$$;

REVOKE ALL ON FUNCTION monitoring.read_cron_job_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION monitoring.read_cron_job_runs() TO txn_agg_monitor;

-- Every run of every scheduled job (0002_maintenance.sql).
CREATE VIEW monitoring.maintenance_runs AS
SELECT job_name,
       started_at,
       finished_at,
       extract(epoch FROM finished_at - started_at) AS duration_seconds,
       status,
       message
FROM monitoring.read_cron_job_runs()
WHERE started_at IS NOT NULL;

-- One row per scheduled job: when it last ran and when it last succeeded. Both
-- jobs run hourly, so a last success more than an hour old means maintenance
-- has stopped: partman makes no new partitions and drops none past retention.
-- A job that has never run has no last_started_at.
CREATE VIEW monitoring.maintenance_status AS
SELECT job_name,
       schedule,
       max(started_at) AS last_started_at,
       max(started_at) FILTER (WHERE status = 'succeeded') AS last_succeeded_at,
       count(*) FILTER (WHERE status = 'failed' AND started_at > now() - interval '1 day') AS failed_runs_last_day
FROM monitoring.read_cron_job_runs()
GROUP BY job_name, schedule;

-- One row per partitioned table in txn_agg: whether partman is keeping its
-- partitions where its config says, and whether the hourly ANALYZE is running.
--   premade_partitions         monthly partitions after this month; should
--                              equal premake
--   partitions_past_retention  partitions that ended longer ago than retention;
--                              should be 0, because maintenance drops them
--   default_partition_rows     rows no monthly partition covers; should stay 0
--   last_analyzed_at           the parent's last ANALYZE; only the hourly job
--                              analyzes a parent, so it should be under an hour old
--   partitions_never_analyzed  partitions that ANALYZE has not reached yet
-- Each partition's range comes from its bound, which Postgres prints as
-- FOR VALUES FROM ('…') TO ('…'), and the default partition's as DEFAULT.
-- partman cuts the months in UTC. The row count is the statistics' live-row
-- count, so the view reads no table rows.
CREATE VIEW monitoring.partition_coverage AS
WITH partition_ranges AS (
    SELECT parent_schema.nspname AS schema_name,
           parent.relname AS table_name,
           parent_stats.last_analyze AS parent_last_analyze,
           pg_get_expr(child.relpartbound, child.oid) = 'DEFAULT' AS is_default,
           range_bounds[1]::timestamptz AS range_from,
           range_bounds[2]::timestamptz AS range_to,
           child_stats.n_live_tup AS live_rows,
           child_stats.last_analyze,
           child_stats.last_autoanalyze
    FROM pg_class parent
    JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
    LEFT JOIN pg_stat_user_tables parent_stats ON parent_stats.relid = parent.oid
    JOIN pg_inherits inheritance ON inheritance.inhparent = parent.oid
    JOIN pg_class child ON child.oid = inheritance.inhrelid
    LEFT JOIN pg_stat_user_tables child_stats ON child_stats.relid = child.oid
    CROSS JOIN LATERAL regexp_match(pg_get_expr(child.relpartbound, child.oid), $$^FOR VALUES FROM \('(.+)'\) TO \('(.+)'\)$$) AS range_bounds
    WHERE parent_schema.nspname = 'txn_agg'
      AND parent.relkind = 'p'
)
SELECT partition_ranges.table_name,
       config.premake,
       count(*) FILTER (WHERE partition_ranges.range_from >= date_trunc('month', now(), 'UTC') + interval '1 month') AS premade_partitions,
       config.retention,
       count(*) FILTER (WHERE partition_ranges.range_to <= now() - config.retention::interval) AS partitions_past_retention,
       count(partition_ranges.range_from) AS monthly_partitions,
       min(partition_ranges.range_from) AS oldest_partition_from,
       max(partition_ranges.range_to) AS newest_partition_to,
       sum(partition_ranges.live_rows) FILTER (WHERE partition_ranges.is_default) AS default_partition_rows,
       partition_ranges.parent_last_analyze AS last_analyzed_at,
       count(*) FILTER (WHERE partition_ranges.last_analyze IS NULL AND partition_ranges.last_autoanalyze IS NULL) AS partitions_never_analyzed
FROM partition_ranges
LEFT JOIN partman.part_config config
       ON config.parent_table = partition_ranges.schema_name || '.' || partition_ranges.table_name
GROUP BY partition_ranges.table_name, partition_ranges.parent_last_analyze, config.premake, config.retention;

-- One row per table in txn_agg, a partitioned table summed over its partitions:
-- its size, and how often it was read by sequential scan or by index.
-- Prometheus has these per partition, which hides the table's totals.
CREATE VIEW monitoring.table_usage AS
SELECT root_table.relname AS table_name,
       sum(pg_table_size(table_stats.relid)) AS table_bytes,
       sum(pg_indexes_size(table_stats.relid)) AS index_bytes,
       sum(table_stats.n_live_tup) AS live_rows,
       sum(table_stats.n_dead_tup) AS dead_rows,
       sum(table_stats.seq_scan) AS sequential_scans,
       sum(table_stats.idx_scan) AS index_scans
FROM pg_stat_user_tables table_stats
JOIN pg_class root_table ON root_table.oid = coalesce(pg_partition_root(table_stats.relid), table_stats.relid)
WHERE table_stats.schemaname = 'txn_agg'
GROUP BY root_table.relname;

-- One row per index in txn_agg, an index on a partitioned table summed over its
-- partitions' copies of it. idx_tx_user_read serves the API's list and summary,
-- transactions_pkey its detail lookup.
CREATE VIEW monitoring.index_usage AS
SELECT root_table.relname AS table_name,
       root_index.relname AS index_name,
       sum(index_stats.idx_scan) AS scans,
       sum(index_stats.idx_tup_read) AS tuples_read,
       sum(pg_relation_size(index_stats.indexrelid)) AS index_bytes
FROM pg_stat_user_indexes index_stats
JOIN pg_class root_table ON root_table.oid = coalesce(pg_partition_root(index_stats.relid), index_stats.relid)
JOIN pg_class root_index ON root_index.oid = coalesce(pg_partition_root(index_stats.indexrelid), index_stats.indexrelid)
WHERE index_stats.schemaname = 'txn_agg'
GROUP BY root_table.relname, root_index.relname;

-- What each role's SQL costs in this database, one row per role and statement
-- shape: parameters show as $1, $2, …, so a list call with an account filter is
-- a different row from one without. mean_plan_milliseconds is the time spent
-- planning each call (pg_stat_statements.track_planning is on in compose).
-- Other roles' query text needs pg_read_all_stats, which txn_agg_monitor holds
-- through pg_monitor.
CREATE VIEW monitoring.statement_stats AS
SELECT pg_roles.rolname AS role_name,
       statements.calls,
       statements.total_exec_time AS total_milliseconds,
       statements.mean_exec_time AS mean_milliseconds,
       statements.max_exec_time AS max_milliseconds,
       statements.stddev_exec_time AS standard_deviation_milliseconds,
       statements.mean_plan_time AS mean_plan_milliseconds,
       statements.rows / greatest(statements.calls, 1) AS rows_per_call,
       statements.shared_blks_hit AS shared_blocks_hit,
       statements.shared_blks_read AS shared_blocks_read,
       statements.query
FROM public.pg_stat_statements statements
JOIN pg_roles ON pg_roles.oid = statements.userid
WHERE statements.dbid = (SELECT oid FROM pg_database WHERE datname = current_database());

GRANT SELECT ON
    monitoring.maintenance_runs,
    monitoring.maintenance_status,
    monitoring.partition_coverage,
    monitoring.table_usage,
    monitoring.index_usage,
    monitoring.statement_stats
TO txn_agg_monitor;
