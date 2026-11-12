# Database

The hand-written SQL that builds the `txn_agg` database, the drizzle-kit runner that applies it, and the grants that say what each role may do on its tables. Postgres itself, with pg_partman and pg_cron, is built in [infrastructure/postgres](../infrastructure/postgres).

## What runs where

Four things build the database. The first two belong to the platform and run as the superuser; the last two belong to the application and run as `admin`:

1. **The image's init scripts** ([infrastructure/postgres/initdb](../infrastructure/postgres/initdb)) run once, when the data volume is empty. They hold the bootstrap: the `txn_agg` and `keycloak` databases, the two logins that own them (`admin` and `keycloak`) and the extensions (pg_partman, pg_cron, pg_stat_statements).
2. **The roles** ([infrastructure/postgres/roles/roles.sql](../infrastructure/postgres/roles/roles.sql)) run as `postgres`, every time: the group roles, and the logins with their passwords and memberships.
3. **The migrations** (`migrations/*.sql`) run as `admin`, in journal order, each once: the schemas, the tables, the seed data, the maintenance jobs and the monitoring views. They hold no roles and no grants.
4. **The grants** (`grants/grants.sql`) run as `admin`, every time: what each group role may do on the tables. See [Access](#access).

On every `make up`, the compose `roles` and `migrate` one-shots run once Postgres is healthy, `grants` runs after both, and the API and the consumers start once it has finished. `drizzle-kit migrate` records each applied file in `drizzle.__drizzle_migrations` and skips it from then on, so `make migrate` can run at any time and applies only what is new.

| File | What it does |
| --- | --- |
| `0000_types_and_tables.sql` | The `txn_agg` schema, the enum types, the tables, the covering read index, and pg_partman's monthly partitioning of `transactions` and `user_transaction_overrides` |
| `0001_seed_categories_and_rules.sql` | The 16 categories with pinned ids, and ruleset 1 |
| `0002_maintenance.sql` | The hourly pg_cron jobs: partman maintenance (new monthly partitions, drop past 18 months) and `ANALYZE` of the partitioned parents |
| `0003_monitoring.sql` | The `monitoring` schema and the views the Grafana Database dashboard reads |

## Adding a migration

drizzle-kit generates no SQL here. The schema is partitioned tables, pg_partman calls and pg_cron jobs, which a schema diff can't express, so every migration is a hand-written SQL file. `drizzle-kit generate --custom` creates an empty one, and `schema.ts` is empty because drizzle-kit refuses to run without a schema file.

1. **Create the file.** The name becomes part of the filename, so say what the migration does:

   ```sh
   cd database
   npm install                                    # first time
   npm run migration:new -- add_merchant_country
   ```

   This writes three things, and all three are committed together:

   - `migrations/0004_add_merchant_country.sql`, empty apart from a header comment;
   - `migrations/meta/0004_snapshot.json`, an empty snapshot, because drizzle-kit keeps one per migration;
   - a new entry in `migrations/meta/_journal.json`, with the time the file was made. The runner applies files in this order.

2. **Write the SQL** in the new file. Qualify every name with its schema (`txn_agg.transactions`), because nothing sets a `search_path`: the runner connects as `admin`, and pg_cron runs its jobs with the default one.

3. **Apply it** to the running stack, from the repo root:

   ```sh
   make migrate
   ```

   The `migrate` service is rebuilt from this folder on every run, so the new file is in the image. From this folder, `npm run migrate` does the same through the published port 5432, with the settings in `.env`.

4. **Regenerate the apps' Drizzle tables** if a table they read has changed: `npm run drizzle:pull-schema` in [apps/api](../apps/api) and [apps/consumer](../apps/consumer), against the migrated stack.

5. **Run an integration suite.** `npm run test:integration` in either app starts the Postgres image with the init scripts, applies the roles, runs every file in `migrations/`, applies `grants/grants.sql`, and tests against the result. CI runs both suites when the migrations, the grants or anything in `infrastructure/postgres/` changes.

### Rules

- **Every database is still rebuilt from empty** (`make clean`), so the four files are edited in place. From the first database that keeps its data, every change is a new file, a changed seed row or a new ruleset included. The runner applies a file only if its journal time is later than the last applied one, so an edit to an applied file never reaches a database that has already run it.
- **Pending files run in one transaction.** A file that fails rolls back everything pending with it, and nothing is recorded, so fix the file and run again. A statement that can't run inside a transaction, such as `CREATE INDEX CONCURRENTLY`, can't be a migration here.
- **No roles and no grants in a migration.** Roles belong in `infrastructure/postgres/roles/roles.sql` and grants in `grants/grants.sql`. `admin`, which runs the migrations, can't create a role, so a migration that tries fails. A table an app writes to needs its write grant added to `grants/grants.sql` in the same change; reads need nothing.
- **A new database or extension belongs in the init scripts,** which run before any migration and as the superuser.

## Access

Who may log in, and what each role may do, is split the way an organisation splits it: a platform step that owns the roles, and an application step that owns the grants on its own tables.

| | Roles | Grants |
| --- | --- | --- |
| File | [`infrastructure/postgres/roles/roles.sql`](../infrastructure/postgres/roles/roles.sql) | [`grants/grants.sql`](grants/grants.sql), in this folder |
| Holds | Who exists: the four group roles, which can't log in, who may connect to the database, and the logins with their passwords and memberships | What each group role may do on the `txn_agg` and `monitoring` schemas, and the write grants per table |
| Changes when | A person or a service needs access | A migration adds or changes a table |
| Runs as | `postgres`, the only role that may create roles | `admin`, which owns the tables and may create no role |
| Compose step | `roles`, once Postgres is healthy | `grants`, after `migrate` and `roles` |
| Re-apply | `make roles` | `make grants` |

A login never holds a privilege directly. It gets them by being a member of group roles, so the group role names are the contract between the two files: `roles.sql` says who is a reader, and `grants.sql` says what a reader can read.

Both files are applied by `psql`, each in one transaction, and every statement is safe to repeat: a role is created only when it is missing, and a grant that is already there is a notice. So both steps run on every `make up`.

**Passwords come from the secrets folder,** never from the SQL. Each login's block reads its file from `SECRET_DIR` and sets it with `ALTER ROLE … PASSWORD`, on every run.

### Adding a login

A read-only reporting login, for example. Nothing in this folder changes:

1. **Add its password file:** `secrets/reporting_read_password`.
2. **Add its block** to `infrastructure/postgres/roles/roles.sql`:

   ```sql
   \set reporting_read_password `cat "$SECRET_DIR/reporting_read_password"`
   SELECT 'CREATE ROLE reporting_read LOGIN'
   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_read') \gexec
   ALTER ROLE reporting_read PASSWORD :'reporting_read_password' CONNECTION LIMIT 5;
   GRANT txn_agg_read TO reporting_read;
   ```

3. **Apply it:** `make roles`.

A login that should see less than `txn_agg_read` gets its own group role in `roles.sql`, with that role's grants in `grants.sql`, and is made a member of that instead. Apply it with `make roles`, then `make grants`.

### Changing a password

Change the file in `secrets/`, run `make roles`, and restart whatever logs in with it. Connections that are already open stay open.

### What it doesn't do

- **It only adds.** Deleting a block or a grant from a file removes nothing from a database that has already run it. Removing a login is a `DROP ROLE` by hand, and taking a privilege back is a `REVOKE` by hand.
- **It doesn't manage `admin` or `keycloak`.** They own the two databases, so the init scripts create them before anything else can run.

## Environment

`drizzle.config.ts` reads six variables and stops without any of them, so a missing one fails the run instead of connecting somewhere unintended. The compose service sets them; on the host, drizzle-kit loads `.env` from this folder:

```sh
cp sample.env .env    # already points at the make up stack
```

| Variable | In `sample.env` | What it is |
| --- | --- | --- |
| `DATABASE_HOST` / `DATABASE_PORT` | `localhost` / `5432` | Where Postgres is; compose uses `postgres` |
| `DATABASE_NAME` | `txn_agg` | The database the migrations build |
| `DATABASE_USER` | `admin` | The login the migrations run as. It owns the database and every object the migrations create |
| `SECRET_DIR` | `./secrets` | The folder the password file is in; compose mounts the repo's `secrets/` as `/secrets` |
| `DATABASE_PASSWORD_SECRET_NAME` | `admin_password` | The file in `SECRET_DIR` that holds the password |

The password is never in the environment. `secrets/admin_password` here is the committed dev password, the same as in the repo's `secrets/`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run migration:new -- <name>` | Creates an empty migration file, its snapshot and its journal entry |
| `npm run migrate` | Applies the pending migrations to the database in `.env` |
| `npm run spell` | Spelling (cspell) over the TypeScript |

## Layout

```text
database
├── Dockerfile               node:24-alpine; the compose migrate one-shot, runs drizzle-kit migrate
├── package.json             drizzle-kit, drizzle-orm and pg
├── drizzle.config.ts        where the migrations live and how the runner connects; no defaults
├── schema.ts                empty: drizzle-kit needs a schema file to run, and generates nothing from it
├── sample.env               environment for the scripts against the make up stack
├── secrets/admin_password   the dev password the scripts read
├── migrations/
│   ├── 0000_….sql           the migrations, applied in journal order
│   └── meta/                _journal.json, the order, and one empty snapshot per file
├── grants/
│   └── grants.sql           what each group role may do on the tables; applied as admin after the migrations
└── query-plans/             SQL run by hand to study the API's queries; the results are in docs/evidence
```
