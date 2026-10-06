-- Custom SQL migration file, put your code below! --

-- account_id joins the read index's stored columns, so a list or summary
-- filtered by account is answered from the index alone instead of reading each
-- row from the table. Dropped and rebuilt under the same name, which keeps the
-- partition index names. Fine at this size inside the migration transaction; on
-- a large live table, build the new index per partition with CONCURRENTLY and
-- attach it instead.
DROP INDEX idx_tx_user_read;
--> statement-breakpoint
CREATE INDEX idx_tx_user_read ON transactions (user_id, occurred_at DESC, transaction_id DESC)
  INCLUDE (transaction_type, direction, status, amount_minor, currency, category_id, short_description, account_id);
