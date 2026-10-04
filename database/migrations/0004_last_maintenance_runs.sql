-- Custom SQL migration file, put your code below! --
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
