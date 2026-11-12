# Database

The hand-written SQL that builds the `txn_agg` database, the drizzle-kit runner that applies it, and the SQL that says who may log in and what each role may do. Postgres itself, with pg_partman and pg_cron, is built in [infrastructure/postgres](../infrastructure/postgres).

## What runs where

Three things build the database, in this order:

1. **The image's init scripts** ([infrastructure/postgres/initdb](../infrastructure/postgres/initdb)) run once, when the data volume is empty. They hold the bootstrap: the `txn_agg` and `keycloak` databases, the two logins that own them (`admin` and `keycloak`) and the extensions (pg_partman, pg_cron, pg_stat_statements).
2. **The migrations** (`migrations/*.sql`) run as `admin`, in journal order, each once: the schemas, the tables, the seed data, the maintenance jobs and the monitoring views. They hold no roles and no grants.
3. **The access files** (`access/*.sql`) run as `postgres`, every time: the group roles and the logins with their passwords, then what each group role may do on the tables. See [Access](#access).

The compose `migrate` one-shot applies the migrations on every `make up`, after Postgres is healthy. The `access` one-shot follows it, and the API and the consumers start once it has finished. `drizzle-kit migrate` records each applied file in `drizzle.__drizzle_migrations` and skips it from then on, so `make migrate` can run at any time and applies only what is new.

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

5. **Run an integration suite.** `npm run test:integration` in either app starts the Postgres image with the init scripts, runs every file in `migrations/`, applies `access/`, and tests against the result. CI runs both suites when anything in `migrations/` or `access/` changes.

### Rules

- **Every database is still rebuilt from empty** (`make clean`), so the four files are edited in place. From the first database that keeps its data, every change is a new file, a changed seed row or a new ruleset included. The runner applies a file only if its journal time is later than the last applied one, so an edit to an applied file never reaches a database that has already run it.
- **Pending files run in one transaction.** A file that fails rolls back everything pending with it, and nothing is recorded, so fix the file and run again. A statement that can't run inside a transaction, such as `CREATE INDEX CONCURRENTLY`, can't be a migration here.
- **No roles and no grants in a migration.** They belong in `access/`. `admin`, which runs the migrations, can't create a role, so a migration that tries fails. A table an app writes to needs its write grant added to `access/grants.sql` in the same change; reads need nothing.
- **A new database or extension belongs in the init scripts,** which run before any migration and as the superuser.

## Access

Who may log in, and what each role may do, is two SQL files in `access/`. Nothing else in the repo creates a role or grants a privilege, apart from the two owner logins in the init scripts.

| File | What it holds |
| --- | --- |
| `access/roles.sql` | Who exists: the four group roles, which can't log in, who may connect to the database, and the logins, one block each with its password, its limits and the group roles it is a member of |
| `access/grants.sql` | What each group role may do on the objects the migrations create: the grants on the `txn_agg` and `monitoring` schemas, and the write grants per table |

A login never holds a privilege directly. It gets them by being a member of group roles, so "who can read?" is answered in one file and "what can a reader read?" in the other.

The two files change for different reasons. `grants.sql` names tables, so it changes together with a migration, and nothing in it needs more than the rights of `admin`, which owns the tables. `roles.sql` names no table: it changes when a person or a service needs access, and it needs a role that may create roles.

**How it is applied.** `psql` runs both files in one transaction, connected as `postgres`, so a statement that fails leaves access as it was. Every statement is safe to repeat: a role is created only when it is missing, and a grant that is already there is a notice. So the compose `access` one-shot applies them on every `make up`, after the migrations, and on a running stack:

```sh
make access
```

**Passwords come from the secrets folder,** never from the SQL. Each block reads its file from `SECRET_DIR` and sets it with `ALTER ROLE … PASSWORD`, on every run.

### Adding a login

A read-only reporting login, for example:

1. **Add its password file:** `secrets/reporting_read_password`.
2. **Add its block** to `access/roles.sql`:

   ```sql
   \set reporting_read_password `cat "$SECRET_DIR/reporting_read_password"`
   SELECT 'CREATE ROLE reporting_read LOGIN'
   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_read') \gexec
   ALTER ROLE reporting_read PASSWORD :'reporting_read_password' CONNECTION LIMIT 5;
   GRANT txn_agg_read TO reporting_read;
   ```

3. **Apply it:** `make access`.

A login that should see less than `txn_agg_read` gets its own group role in `access/roles.sql`, with that role's grants in `access/grants.sql`, and is made a member of that instead.

### Changing a password

Change the file in `secrets/`, run `make access`, and restart whatever logs in with it. Connections that are already open stay open.

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
├── access/
│   ├── roles.sql            the group roles, the logins, their passwords and their memberships
│   └── grants.sql           what each group role may do on the tables
└── query-plans/             SQL run by hand to study the API's queries; the results are in docs/evidence
```
