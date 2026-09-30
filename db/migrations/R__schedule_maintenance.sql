-- Nightly pg_partman maintenance: creates upcoming monthly partitions and drops
-- partitions past retention. Scheduling the same job name again updates it in place.
SELECT cron.schedule(
    'partman-maintenance',
    '0 0 * * *',
    $$CALL partman.run_maintenance_proc()$$
);
