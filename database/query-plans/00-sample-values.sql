-- Query plans for the API's SQL, against the dev database.
--
-- To see the SQL the API sends, run the API locally with DATABASE_QUERY_LOG in
-- apps/api/.env (development only; see apps/api/sample.env):
--   sql   logs each statement with its values filled in, ready to paste into
--         DBeaver or psql
--   plan  also logs its plan: EXPLAIN (ANALYZE, BUFFERS) for a read, which runs
--         it a second time; plain EXPLAIN for a write, which does not run it
-- Then call the API (Bruno). Paste a logged statement here to time it again or
-- try a change.
--
-- This folder:
--   00-sample-values.sql              connection, how to read plans, values to use
--   01-seed-test-user.sql             a user with 100,000 rows, for plans at volume
--   02-seek-vs-offset-pagination.sql  seek against OFFSET, 90,000 rows deep
--   03-api-query-stats.sql            what the API's queries cost on real calls
--
-- Connection: PostgreSQL, localhost:5432, database txn_agg, user admin
-- (password in secrets/admin_password). 03-api-query-stats.sql needs the
-- superuser instead: postgres / postgres on the dev stack.
--
-- Running a plan:
--   * Put the cursor inside a statement and run it (Ctrl+Enter, Cmd+Enter on
--     macOS). The plan comes back as rows of one QUERY PLAN column.
--   * For DBeaver's plan tree, select the query without its EXPLAIN line and
--     use Execute > Explain Execution Plan. Tick ANALYZE and BUFFERS if it asks.
--   * For a visual plan, change the options to (ANALYZE, BUFFERS, FORMAT JSON)
--     and paste the result into https://explain.dalibo.com.
--   * Run each plan twice. The first run on a new connection loads the partition
--     metadata, so its Planning Time is several times the second's.
--
-- Values to call the API with: the queries below pick the user with the most
-- rows and a 365-day window over the seeded corpus (SEED=42,
-- ANCHOR_DATE=2026-10-04). User ids and timestamps survive
-- `make clean && make up`. Transaction ids do not: the database mints them with
-- uuidv7() on insert, so re-run the queries after a rebuild. 01 seeds a test
-- user with fixed ids, so 02 needs no re-picking.
--
-- The data is small (about 26 rows per user), so every plan runs in a few
-- milliseconds. Read the shape of each plan: which index, how many partitions,
-- whether LIMIT stops the scan early. For volume, call the API as the test user
-- from 01-seed-test-user.sql (100,000 rows).


-- The users with the most rows
SELECT user_id, count(*) AS rows
FROM transactions
GROUP BY user_id
ORDER BY count(*) DESC, user_id
LIMIT 5;

-- That user's rows in the window, newest first, numbered. Each cursor value is
-- written exactly as the API puts it in links.next/links.prev:
--   row 10 → a next page from page 1 at limit=10
--   row 11 → a prev page back from page 2
--   row 1  → a transaction to fetch, override or archive
SELECT row_number() OVER (ORDER BY occurred_at DESC, transaction_id DESC) AS row,
       to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_occurred_at,
       transaction_id AS cursor_transaction_id,
       account_id,
       transaction_type,
       direction,
       amount_minor,
       category_id
FROM transactions
WHERE user_id = '46acaa64-caf9-4577-b4a0-c25f09a8bb66'
  AND occurred_at >= '2025-10-04T00:00:00.000Z'
  AND occurred_at < '2026-10-04T00:00:00.000Z'
ORDER BY occurred_at DESC, transaction_id DESC;

-- That user's accounts and categories, for the list's filters
SELECT account_id, count(*) AS rows
FROM transactions
WHERE user_id = '46acaa64-caf9-4577-b4a0-c25f09a8bb66'
GROUP BY account_id
ORDER BY count(*) DESC;

SELECT categories.category_id, categories.category, count(*) AS rows
FROM transactions
JOIN categories ON categories.category_id = transactions.category_id
WHERE transactions.user_id = '46acaa64-caf9-4577-b4a0-c25f09a8bb66'
GROUP BY categories.category_id, categories.category
ORDER BY count(*) DESC;
