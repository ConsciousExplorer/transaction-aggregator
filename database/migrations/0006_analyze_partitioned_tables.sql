-- Custom SQL migration file, put your code below! --

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
