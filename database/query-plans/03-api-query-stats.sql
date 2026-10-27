-- What the API's queries actually cost, measured by Postgres on every real call
-- (pg_stat_statements). DATABASE_QUERY_LOG=plan (apps/api/.env) shows how a
-- query runs; these show how often each ran and how long it took. While plan
-- mode is on, every read is counted twice: its EXPLAIN ANALYZE runs it again.
--
-- Connect as postgres / postgres (the dev superuser). As admin the query
-- column reads <insufficient privilege>.
--
-- Each row is one query shape with its parameters as $1, $2, …: a list call
-- with an account filter is a different row from one without.
--
-- mean_plan_ms is the time Postgres spent planning each call
-- (pg_stat_statements.track_planning, on in compose). On list pages it is
-- larger than mean_ms: about 0.8 ms planning against 0.2 ms running on
-- 2026-10-07, because every call plans 22+ partitions and three joins.

SELECT s.calls,
       round(s.mean_exec_time::numeric, 3)   AS mean_ms,
       round(s.max_exec_time::numeric, 3)    AS max_ms,
       round(s.stddev_exec_time::numeric, 3) AS stddev_ms,
       round(s.mean_plan_time::numeric, 3)   AS mean_plan_ms,
       s.rows / greatest(s.calls, 1)         AS rows_per_call,
       s.shared_blks_hit,
       s.shared_blks_read,
       s.query
FROM pg_stat_statements s
JOIN pg_roles r ON r.oid = s.userid
WHERE r.rolname = 'api_write'
ORDER BY s.total_exec_time DESC;

-- How often each transactions index was used, summed over its partitions.
-- idx_tx_user_read serves the list and the summary; transactions_pkey serves
-- the detail lookup.
SELECT parent.relname        AS index_name,
       count(*)              AS partitions,
       sum(stats.idx_scan)   AS scans,
       sum(stats.idx_tup_read) AS tuples_read,
       pg_size_pretty(sum(pg_relation_size(stats.indexrelid))) AS size
FROM pg_stat_user_indexes stats
JOIN pg_inherits inh ON inh.inhrelid = stats.indexrelid
JOIN pg_class parent ON parent.oid = inh.inhparent
WHERE stats.relname LIKE 'transactions_%'
GROUP BY parent.relname
ORDER BY parent.relname;

-- To measure from zero, for example before a k6 run (superuser only):
-- SELECT pg_stat_statements_reset();
