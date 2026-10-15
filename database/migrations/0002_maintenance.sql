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
-- :30, after partman-maintenance at :00 has created any new partitions. The
-- names are qualified because pg_cron runs the command on the default
-- search_path, which does not include txn_agg.
SELECT cron.schedule(
    'analyze-partitioned-tables',
    '30 * * * *',
    $$ANALYZE txn_agg.transactions, txn_agg.user_transaction_overrides$$
);
