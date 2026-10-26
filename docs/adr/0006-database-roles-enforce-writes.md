# 0006. Database roles decide who can write what

- **Status:** Accepted
- **Where it lives:** [`03-permissions.sql`](../../infrastructure/postgres/initdb/03-permissions.sql), the grants at the end of [`0000_types_and_tables.sql`](../../database/migrations/0000_types_and_tables.sql), [`database-roles.test.ts`](../../apps/api/test/integration/database-roles.test.ts)
- **Related:** [0004](0004-versioned-rules-read-time-overrides.md), [0005](0005-one-partitioned-table.md)

## Context

Two apps write to one database:

- **The consumer** writes transactions.
- **The API** writes users' category preferences.

A transaction is a fact from a source system, and nothing in this system should be able to change one. A preference should be undoable and inspectable later, so it is never hard-deleted.

Rules like these, enforced only in application code, hold only until the first bug or the first leaked credential.

## Decision

**Privileges belong to group roles that can't log in. Each app's login is a member of the groups it needs.**

| Group role | Can do | Granted to |
| --- | --- | --- |
| `txn_agg_read` | `SELECT` on every table in `txn_agg` | `txn_agg_write`, `api_write`, `api_read`, `grafana_read` |
| `txn_agg_write` | `INSERT` on `transactions`, and reads through `txn_agg_read` | `kafka_consumer` |
| `txn_agg_prefs_write` | `SELECT`, `INSERT` and `UPDATE` on the two override tables | `api_write` |
| `txn_agg_monitor` | `pg_monitor`, and the views in `monitoring` | `grafana_read`, `postgres_exporter` |

Three consequences of that table are the point of this decision:

- **The API can't change a transaction.** Its login, `api_write`, holds no write privilege on `transactions`. It writes preferences directly, in one synchronous call, but only those.
- **The consumer can't change a preference or delete a transaction.** It can insert transactions, and that is all it can write.
- **Nothing can delete a preference.** No app role has `DELETE` or `TRUNCATE` on any table. Deleting an override archives it (`UPDATE … SET archived_at`), and archived rows go only when retention drops their partition.

**Only migrations change the categories and rules:** the apps can only read those tables, and `admin`, which runs the migrations, owns everything. `PUBLIC` is revoked on the database and on `public`.

**A test proves both sides.** `database-roles.test.ts` connects as the real logins against a Postgres built from the repo's own image. It checks that:

- `api_write` can't insert a transaction, delete an override or insert a category;
- `kafka_consumer` can't delete a transaction or write an override.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Preference writes sent through Kafka to the consumer | The API would need broker credentials, and a preference toggle would become eventually consistent. |
| One login for both apps | A bug or a leaked password in either app could then change facts. |
| Enforcing the rules in application code only | Nothing proves it, and a single missed check breaks it. |
| Hard `DELETE` for preferences | It destroys the record that support and debugging need. |
| Row-level security per user | The database never knows the end user. The API scopes every query by the `userId` in the path ([0008](0008-service-to-service-auth.md)). |

## Consequences

- "The API can't change a fact" is a grant, and a test checks it.
- **A leaked API credential is contained:** it can read data and change preferences, but it can't alter or destroy transactions.
- **New tables need explicit grants:** every new table needs its write grants added to the migration by hand. Reads come from the default privilege.
- **Archived remaps never go away:** `user_category_overrides` isn't partitioned, so its archived rows stay for good.
- **`api_read` is unused:** the login exists, but nothing uses it.

## Revisit when

- **Another service shares the database:** give it its own schema and group roles.
