-- What each group role may do on the objects the migrations create.
-- Split from roles.sql because every statement here names a schema or a table:
-- this file changes with a migration, and needs only the owner's rights.
-- Safe to re-run (make access).


-- Read: every table in txn_agg, including ones added later

GRANT USAGE ON SCHEMA txn_agg TO txn_agg_read;
GRANT SELECT ON ALL TABLES IN SCHEMA txn_agg TO txn_agg_read;
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA txn_agg GRANT SELECT ON TABLES TO txn_agg_read;


-- Write: per table, by name

GRANT INSERT ON txn_agg.transactions TO txn_agg_write;
GRANT SELECT, INSERT, UPDATE ON txn_agg.user_transaction_overrides, txn_agg.user_category_overrides TO txn_agg_prefs_write;


-- Monitor: every view and function in monitoring, including ones added later

GRANT USAGE ON SCHEMA monitoring TO txn_agg_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA monitoring TO txn_agg_monitor;
ALTER DEFAULT PRIVILEGES FOR ROLE admin IN SCHEMA monitoring GRANT SELECT ON TABLES TO txn_agg_monitor;

-- A new function is executable by everyone until revoked
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA monitoring FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA monitoring TO txn_agg_monitor;
