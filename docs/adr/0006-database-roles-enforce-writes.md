# 0006. Database roles decide who can write what

- **Status:** Accepted
- **Where it lives:** [`roles.sql`](../../infrastructure/postgres/roles/roles.sql), [`grants.sql`](../../database/grants/grants.sql), [`database-roles.test.ts`](../../apps/api/test/integration/database-roles.test.ts)
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

Three consequences of that table:

- **The API can't change a transaction.** Its login, `api_write`, holds no write privilege on `transactions`. It writes preferences directly, in one synchronous call, but only those.
- **The consumer can't change a preference or delete a transaction.** It can insert transactions, and that is all it can write.
- **Nothing can delete a preference.** No app role has `DELETE` or `TRUNCATE` on any table. Deleting an override archives it (`UPDATE … SET archived_at`), and archived rows go only when retention drops their partition.

**Only migrations change the categories and rules:** the apps can only read those tables, and `admin`, which runs the migrations, owns everything. `PUBLIC` is revoked on the database and on `public`.

**Roles and grants are kept apart from the migrations.** They are two SQL files with two owners, split the way an organisation splits them. `roles.sql` is the platform's: who exists (the group roles, the logins and their memberships). It sits with the infrastructure and runs as the superuser. `grants.sql` is the application's: what each group role may do on the tables. It sits beside the migrations and runs as `admin`, which owns the tables and may create no role. Both run on every start, each statement is safe to repeat, and `make roles` or `make grants` applies one to a running database, so a new login or a changed password needs no migration. Passwords are read from the secrets folder, never written in the SQL.

**A test proves both sides.** `database-roles.test.ts` connects as the real logins against a Postgres built from the repo's own image. It checks that:

- `api_write` can't insert a transaction, delete an override or insert a category;
- `kafka_consumer` can't delete a transaction or write an override.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Preference writes sent through Kafka to the consumer | The API would need broker credentials, and a preference toggle would become eventually consistent. |
| One login for both apps | A bug or a leaked password in either app could then change facts. |
| Enforcing the rules in application code only | Nothing proves it, and a single missed check breaks it. |
| Roles in the Postgres init scripts and grants in the migrations | Init scripts run only on an empty volume, so a new login could not reach a database that keeps its data, and the grants were spread through the table definitions. |
| Terraform's `postgresql` provider for roles and grants | It also removes what is no longer declared, but it adds a state file and a second tool to a stack that one `psql` command covers. |
| Hard `DELETE` for preferences | It destroys the record that support and debugging need. |
| Row-level security per user | The database never knows the end user. The API scopes every query by the `userId` in the path ([0008](0008-service-to-service-auth.md)). |

## Consequences

- "The API can't change a fact" is a grant, and a test checks it.
- **A leaked API credential is contained:** it can read data and change preferences, but it can't alter or destroy transactions.
- **New tables need explicit grants:** every new table needs its write grants added to `grants.sql` by hand, in the same change as its migration. Reads come from the default privilege.
- **Access only grows by itself:** the two files add roles and grants and never remove them. Dropping a login or taking a privilege back is done by hand.
- **Archived remaps never go away:** `user_category_overrides` isn't partitioned, so its archived rows stay for good.
- **`api_read` serves tooling only:** no running service logs in with it. The API's drizzle-kit `pull` and `studio` scripts do, so they read the schema without any write grant.
