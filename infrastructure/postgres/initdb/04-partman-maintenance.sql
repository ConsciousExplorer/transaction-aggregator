-- Schedule pg_partman maintenance to run at the start of every day

SELECT cron.schedule(
    'partman-maintenance', 
    '0 0 * * *', 
    $$CALL partman.run_maintenance_proc()$$
);