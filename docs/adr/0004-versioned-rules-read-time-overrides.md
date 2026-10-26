# 0004. Rules categorise at ingest from versioned rule sets; user overrides apply on read

- **Status:** Accepted
- **Where it lives:** [`rule-categoriser.ts`](../../apps/consumer/src/domain/rule-categoriser.ts), [`0001_seed_categories_and_rules.sql`](../../database/migrations/0001_seed_categories_and_rules.sql), [`transaction-conditions.ts`](../../apps/api/src/integrations/database/repositories/transaction-conditions.ts)
- **Related:** [0005](0005-one-partitioned-table.md), [0006](0006-database-roles-enforce-writes.md)

## Context

Every transaction needs a category, decided at ingest, at Kafka's pace and with no network call per message. It must also be possible to say later why a transaction got the category it has.

Users disagree with the system. One user wants a single transaction moved. Another wants everything in one category shown as another, including transactions that haven't arrived yet. Either change must be easy to undo.

## Decision

**The consumer categorises in-process from a compiled rule set.**

The rules are tried in tiers, and the first match wins:

1. **MCC:** the card's merchant category code.
2. **Keyword:** a word in the description. Card and debit order only.
3. **Source and operation:** the source plus `metadata.operation`.
4. **Source and credit/debit:** for example, an EFT credit is `income`.
5. **Source default.**
6. **Fallback:** `uncategorised`.

Categorising can't fail, because the fallback always matches. The rule set is loaded and compiled once at startup.

**Rule sets are versioned and append-only.**

- `rule_sets` holds the versions, and `categorization_rules` holds each version's rules. The active version is the highest.
- Every stored row records the category, the `rule_version` and the `rule_priority` that matched. A composite foreign key points at that exact rule. A null priority means the fallback matched.
- A rule change is a new version, added by a migration. The apps can only read the rule tables, so only a migration can change them.
- Rows already stored keep the version that categorised them.
- The seed pins the 16 category ids, so the ids are the same in every environment.

**User overrides live in two tables and are resolved when a row is read.**

- `user_transaction_overrides` moves one transaction to another category.
- `user_category_overrides` remaps one category to another for one user, for past and future transactions alike.
- Every read takes `coalesce(transaction override, category remap, stored category)`. That is one set of SQL joins, shared by the list, the detail and the summary.
- A remap matches the stored category, so remaps don't chain.
- Deleting an override archives it (`archived_at`), and setting it again revives the row. The stored category is never touched, so undoing an override is always one row.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A remote or ML categoriser | It would make a network call per message in the hot path, and its verdicts are harder to explain. |
| Editing rules in place | The rule that categorised an old row would no longer exist, so no verdict could be explained afterwards. |
| Rewriting stored categories when a user recategorises | It misses future transactions, writes thousands of rows, and makes undoing it messy. It also breaks the rule that stored rows are facts the API can't change ([0006](0006-database-roles-enforce-writes.md)). |
| Resolving overrides in application code | It needs a second query per page, and the category filter could no longer be applied in SQL. |
| An override history table | The current state, its `updated_at` and the API's audit log line already say who changed what. |

## Consequences

- Categorising costs microseconds and never fails a message.
- **Rule changes need a migration and a restart:** a consumer picks up a new rule set only when it restarts.
- **Old rows keep old verdicts:** re-categorising history would need a backfill job, which doesn't exist.
- **Reads cost two joins:** every read joins the two override tables. Both are small and keyed for the join.
- **Downstream sees the system category:** anything reading stored rows directly, such as an export, gets the system category unless it applies the same resolution ([0011](0011-egress.md)).
- **Append-only is partly by convention:** the grants stop the apps changing rules, but nothing stops a migration editing a version's rows.

## Revisit when

- Rules change often enough that a migration and a restart are too slow: load new versions without a restart.
- Users need remaps to chain, or rules of their own.
- A model beats the rules on accuracy: put it behind the same categorise step and record its version the same way.
