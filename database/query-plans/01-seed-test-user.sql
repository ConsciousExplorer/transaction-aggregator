-- A test user with 100,000 transactions, for plans at a volume no seeded user
-- reaches (the busiest has 49 rows). 02-seek-vs-offset-pagination.sql reads it,
-- and the API serves it like any other user: call it with this user id.
--
--   userId    00000000-0000-4000-8000-000000000001 (no generator produces it)
--   accounts  00000000-0000-4000-8000-0000000000a1, …a2, …a3 (a third each)
--   window    one row every 315 seconds, newest 2026-10-03 23:54:45 UTC,
--             oldest 2025-10-04 10:00:00 UTC: all inside the files' window
--
-- Every value is computed from the row number n, so the data is the same on
-- every run and the cursors written into 02 stay valid after a rebuild. Row n
-- is the n-th newest, and its transaction_id ends in n. Running the INSERT
-- again adds nothing: ON CONFLICT skips rows that exist.
--
-- The API serves this user like any other. The metadata copies the shape the
-- consumer wrote for each type before it stored clearingType, so EFT details
-- return clearingType null, as they do for the older real EFT rows.
--
-- Run the INSERT, then the VACUUM, one at a time (Cmd+Enter). Both commit.
--
-- Delete the user before the E2E harness or the replay proof: they assert
-- row counts, and these rows were never produced to Kafka.


-- 1. Insert (a few seconds)
WITH kinds (kind, transaction_type, short_description, metadata) AS (
  VALUES
    (0, 'card'::transaction_type, 'Test merchant',
     '{"mcc": "5311", "authCode": "241817", "cardLast4": "6444", "cardNetwork": "amex", "merchantName": "Test merchant", "posEntryMode": "chip"}'::jsonb),
    (1, 'eft'::transaction_type, 'Test payee',
     '{"reference": "Test reference", "branchCode": "527490", "beneficiaryBank": "TymeBank", "beneficiaryName": "Test payee", "beneficiaryAccountLast4": "7922"}'::jsonb),
    (2, 'debit_order'::transaction_type, 'Test creditor',
     '{"category": "LOAN_REPAYMENT", "frequency": "monthly", "mandateId": "55a6a3f1-50c2-4d5d-bdee-d28f38996a54", "creditorName": "Test creditor", "collectionType": "tracking", "creditorAbbrevName": "TEST"}'::jsonb),
    (3, 'internal_transfer'::transaction_type, NULL,
     '{"toAccountId": "00000000-0000-4000-8000-0000000000a2", "fromAccountId": "00000000-0000-4000-8000-0000000000a1", "toAccountType": "savings", "fromAccountType": "current"}'::jsonb),
    (4, 'loan'::transaction_type, NULL,
     '{"loanType": "personal", "operation": "repayment", "loanAccountId": "00000000-0000-4000-8000-0000000000a3", "interestAmount": 12000, "principalAmount": 88000}'::jsonb)
)
INSERT INTO transactions (
  transaction_id, user_id, account_id, transaction_type, external_id, occurred_at,
  direction, status, amount_minor, currency, long_description, short_description,
  category_id, rule_version, rule_priority, metadata
)
SELECT ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,   -- row 42 → …-000000000042
       '00000000-0000-4000-8000-000000000001',
       ('00000000-0000-4000-8000-0000000000a' || (1 + n % 3))::uuid,
       kinds.transaction_type,
       'test-user-' || n,
       timestamptz '2026-10-04 00:00:00+00' - n * interval '315 seconds',
       CASE WHEN n % 10 = 0 THEN 'credit' ELSE 'debit' END::direction_type,
       CASE WHEN n % 20 = 0 THEN 'pending' ELSE 'completed' END::transaction_status,
       100 + (n * 7919) % 500000,
       'ZAR',
       'Test transaction ' || n,
       kinds.short_description,
       1 + n % 16,
       1,
       NULL,      -- no rule lineage, so the (rule_version, rule_priority) foreign key is skipped
       kinds.metadata
FROM generate_series(1, 100000) AS n
JOIN kinds ON kinds.kind = n % 5
ON CONFLICT DO NOTHING;

-- 2. Refresh the planner's statistics, so it knows this user has 100,000 rows,
-- and mark the new pages all-visible, so Index Only Scans skip the table
-- (Heap Fetches: 0) as they do once autovacuum has run
VACUUM (ANALYZE) transactions;

-- 3. Check: expect 100000, 2025-10-04 10:00:00+00, 2026-10-03 23:54:45+00
SELECT count(*), min(occurred_at), max(occurred_at)
FROM transactions
WHERE user_id = '00000000-0000-4000-8000-000000000001';


-- Cleanup: remove the test user, then rebuild the indexes and statistics.
-- A delete leaves dead entries in every index; REINDEX drops them, so the
-- next plans aren't measured on a bloated index.
-- DELETE FROM transactions WHERE user_id = '00000000-0000-4000-8000-000000000001';
-- REINDEX TABLE transactions;
-- VACUUM (ANALYZE) transactions;
