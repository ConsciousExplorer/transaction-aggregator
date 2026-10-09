-- Seek pagination (what the API does) against OFFSET pagination (page N built
-- by skipping (N - 1) × page size rows), on the test user from
-- 01-seed-test-user.sql. Run 01 first.
--
-- All four queries fetch the same page: the page after row 90,000 of 100,000,
-- newest first, limit=50 → LIMIT 51.
--   userId               00000000-0000-4000-8000-000000000001
--   fromDateTime         2025-10-04T00:00:00.000Z
--   toDateTime           2026-10-04T00:00:00.000Z
--   cursor occurredAt    2025-11-09T21:00:00.000000Z   (row 90,000)
--   cursor transactionId 10000000-0000-4000-8000-000000090000
--
-- Compare the Buffers line under Limit (index and table pages touched) and
-- Execution Time. Run each twice; the first run reads pages into cache.
--
-- What the four show:
--   1. Seek with the window first, as the API sent it until 2026-10-07: skips
--      the joins and the sort for rows before the cursor, but each
--      partition's scan starts at toDateTime and walks the index down to the
--      cursor. Cheaper than OFFSET, not flat.
--   2. OFFSET: reads, joins and sorts every row before the page.
--   3. Proof that 1 and 2 return the same rows.
--   4. Seek with the cursor conditions first, as the API sends it now: the
--      scan starts at the cursor, so the page costs the same at any depth.


-- 1. Seek with the window first (the API's SQL until 2026-10-07)
-- Look for: under Limit, about 1,500 buffers for 51 rows. Each partition newer
-- than the cursor shows rows=0 with about 130 buffers: its scan began at
-- toDateTime and walked every index entry of the month to reach the cursor.
-- The row comparison is in the Index Cond, but Postgres picked the
-- occurred_at < toDateTime condition, listed first, as where to start.
EXPLAIN (ANALYZE, BUFFERS)
SELECT transactions.transaction_id,
       transactions.occurred_at,
       transactions.transaction_type,
       transactions.direction,
       transactions.status,
       transactions.amount_minor,
       transactions.currency,
       categories.category,
       transactions.short_description,
       to_char(transactions.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
FROM transactions
LEFT JOIN user_transaction_overrides
  ON (user_transaction_overrides.transaction_id = transactions.transaction_id
  AND user_transaction_overrides.occurred_at = transactions.occurred_at
  AND user_transaction_overrides.archived_at IS NULL)
LEFT JOIN user_category_overrides
  ON (user_category_overrides.user_id = transactions.user_id
  AND user_category_overrides.from_category_id = transactions.category_id
  AND user_category_overrides.archived_at IS NULL)
INNER JOIN categories
  ON categories.category_id = coalesce(user_transaction_overrides.category_id,
                                       user_category_overrides.to_category_id,
                                       transactions.category_id)
WHERE (transactions.user_id = '00000000-0000-4000-8000-000000000001'
  AND transactions.occurred_at >= '2025-10-04T00:00:00.000Z'
  AND transactions.occurred_at < '2026-10-04T00:00:00.000Z'
  AND (transactions.occurred_at, transactions.transaction_id)
      < ('2025-11-09T21:00:00.000000Z'::timestamptz, '10000000-0000-4000-8000-000000090000'::uuid))
ORDER BY transactions.occurred_at DESC, transactions.transaction_id DESC
LIMIT 51;

-- 2. OFFSET: the same query with OFFSET 90000 in place of the cursor
-- Look for: the scans return all 100,000 rows and the Hash Join runs for every
-- one. The Sort spills to disk (Sort Method: external merge), hands Limit
-- 90,051 rows, and Limit throws 90,000 away. Execution Time is many times 1's.
EXPLAIN (ANALYZE, BUFFERS)
SELECT transactions.transaction_id,
       transactions.occurred_at,
       transactions.transaction_type,
       transactions.direction,
       transactions.status,
       transactions.amount_minor,
       transactions.currency,
       categories.category,
       transactions.short_description,
       to_char(transactions.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
FROM transactions
LEFT JOIN user_transaction_overrides
  ON (user_transaction_overrides.transaction_id = transactions.transaction_id
  AND user_transaction_overrides.occurred_at = transactions.occurred_at
  AND user_transaction_overrides.archived_at IS NULL)
LEFT JOIN user_category_overrides
  ON (user_category_overrides.user_id = transactions.user_id
  AND user_category_overrides.from_category_id = transactions.category_id
  AND user_category_overrides.archived_at IS NULL)
INNER JOIN categories
  ON categories.category_id = coalesce(user_transaction_overrides.category_id,
                                       user_category_overrides.to_category_id,
                                       transactions.category_id)
WHERE (transactions.user_id = '00000000-0000-4000-8000-000000000001'
  AND transactions.occurred_at >= '2025-10-04T00:00:00.000Z'
  AND transactions.occurred_at < '2026-10-04T00:00:00.000Z')
ORDER BY transactions.occurred_at DESC, transactions.transaction_id DESC
OFFSET 90000
LIMIT 51;

-- 3. 1 and 2 return the same page. Expect: page_rows 51, rows_that_differ 0.
WITH by_seek AS (
  SELECT transaction_id
  FROM transactions
  WHERE user_id = '00000000-0000-4000-8000-000000000001'
    AND occurred_at >= '2025-10-04T00:00:00.000Z'
    AND occurred_at < '2026-10-04T00:00:00.000Z'
    AND (occurred_at, transaction_id)
        < ('2025-11-09T21:00:00.000000Z'::timestamptz, '10000000-0000-4000-8000-000000090000'::uuid)
  ORDER BY occurred_at DESC, transaction_id DESC
  LIMIT 51
), by_offset AS (
  SELECT transaction_id
  FROM transactions
  WHERE user_id = '00000000-0000-4000-8000-000000000001'
    AND occurred_at >= '2025-10-04T00:00:00.000Z'
    AND occurred_at < '2026-10-04T00:00:00.000Z'
  ORDER BY occurred_at DESC, transaction_id DESC
  OFFSET 90000
  LIMIT 51
)
SELECT (SELECT count(*) FROM by_seek) AS page_rows,
       (SELECT count(*) FROM (SELECT * FROM by_seek EXCEPT SELECT * FROM by_offset) d) AS rows_that_differ;

-- 4. Seek with the cursor conditions first: the SQL the API sends now
-- Two changes to 1's WHERE: a plain occurred_at <= (cursor occurredAt) bound,
-- and both cursor conditions before the window. The rows are the same:
-- every row before the cursor already satisfies occurred_at <= cursor.
-- Look for: about 110 buffers under Limit instead of 1's ~1,500, most of them
-- the override joins, and well under a millisecond. The partitions newer than
-- the cursor are gone from the plan (the plain bound prunes them), the
-- cursor's partition starts at the cursor, and the scan stops at 51 rows. For an ascending read (a prev cursor, or
-- sort=occurredAt) the plain bound is occurred_at >= the cursor's occurredAt.
EXPLAIN (ANALYZE, BUFFERS)
SELECT transactions.transaction_id,
       transactions.occurred_at,
       transactions.transaction_type,
       transactions.direction,
       transactions.status,
       transactions.amount_minor,
       transactions.currency,
       categories.category,
       transactions.short_description,
       to_char(transactions.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
FROM transactions
LEFT JOIN user_transaction_overrides
  ON (user_transaction_overrides.transaction_id = transactions.transaction_id
  AND user_transaction_overrides.occurred_at = transactions.occurred_at
  AND user_transaction_overrides.archived_at IS NULL)
LEFT JOIN user_category_overrides
  ON (user_category_overrides.user_id = transactions.user_id
  AND user_category_overrides.from_category_id = transactions.category_id
  AND user_category_overrides.archived_at IS NULL)
INNER JOIN categories
  ON categories.category_id = coalesce(user_transaction_overrides.category_id,
                                       user_category_overrides.to_category_id,
                                       transactions.category_id)
WHERE (transactions.user_id = '00000000-0000-4000-8000-000000000001'
  AND transactions.occurred_at <= '2025-11-09T21:00:00.000000Z'
  AND (transactions.occurred_at, transactions.transaction_id)
      < ('2025-11-09T21:00:00.000000Z'::timestamptz, '10000000-0000-4000-8000-000000090000'::uuid)
  AND transactions.occurred_at >= '2025-10-04T00:00:00.000Z'
  AND transactions.occurred_at < '2026-10-04T00:00:00.000Z')
ORDER BY transactions.occurred_at DESC, transactions.transaction_id DESC
LIMIT 51;

-- Other depths: the test data makes any row's cursor easy to compute. For the
-- page after row N:
--   cursor occurredAt    2026-10-04 00:00:00 UTC minus N × 315 seconds
--   cursor transactionId 10000000-0000-4000-8000-<N padded to 12 digits>
--   OFFSET               N
