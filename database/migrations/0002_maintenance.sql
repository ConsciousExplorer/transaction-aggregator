-- Custom SQL migration file, put your code below! --

-- pg_partman maintenance, hourly: creates upcoming monthly partitions and drops
-- partitions past retention. Hourly rather than nightly, because a dev stack is
-- rarely up at midnight. Scheduling the same job name again updates it in place.
SELECT cron.schedule(
    'partman-maintenance',
    '0 * * * *',
    $$CALL partman.run_maintenance_proc()$$
);

-- Autovacuum never analyzes a partitioned table's parent, nor a partition that
-- has never changed (an empty override partition, a partition partman just
-- created). Without statistics the planner guesses their size. ANALYZE on a
-- parent refreshes the parent's statistics and every partition's. Hourly at
-- :30, after partman-maintenance at :00 has created any new partitions.
SELECT cron.schedule(
    'analyze-partitioned-tables',
    '30 * * * *',
    $$ANALYZE transactions, user_transaction_overrides$$
);

-- The last ten partman-maintenance runs, for the Grafana database dashboard.
-- SECURITY DEFINER because grafana_read can't read the cron schema itself.
CREATE FUNCTION public.last_maintenance_runs()
RETURNS TABLE (started_at timestamptz, finished_at timestamptz, status text, message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT d.start_time, d.end_time, d.status, d.return_message
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
    WHERE j.jobname = 'partman-maintenance'
    ORDER BY d.start_time DESC
    LIMIT 10
$$;

REVOKE ALL ON FUNCTION public.last_maintenance_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.last_maintenance_runs() TO grafana_read;
