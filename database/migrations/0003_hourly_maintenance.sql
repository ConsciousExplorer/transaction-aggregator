-- Custom SQL migration file, put your code below! --
SELECT cron.schedule(
    'partman-maintenance',
    '0 * * * *',
    $$CALL partman.run_maintenance_proc()$$
);
