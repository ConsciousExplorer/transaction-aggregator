# Database

The hand-written SQL that builds the `txn_agg` database, and the drizzle-kit runner that applies it. Postgres itself, with pg_partman and pg_cron, is built in [infrastructure/postgres](../infrastructure/postgres).

## What runs where

Two things build the database, in this order:

1. **The image's init scripts** ([infrastructure/postgres/initdb](../infrastructure/postgres/initdb)) run once, when the data volume is empty. They hold what lives outside a schema: the `txn_agg` and `keycloak` databases, the extensions (pg_partman, pg_cron, pg_stat_statements) and every role.
2. **The migrations** (`migrations/*.sql`) run as `admin`, in journal order, each once: the schemas, the tables and their grants, the seed data, the maintenance jobs and the monitoring views.

The compose `migrate` one-shot applies the migrations on every `make up`, after Postgres is healthy and before the API and the consumers start. `drizzle-kit migrate` records each applied file in `drizzle.__drizzle_migrations` and skips it from then on, so `make migrate` can run at any time and applies only what is new.

| File | What it does |
| --- | --- |
| `0000_types_and_tables.sql` | The `txn_agg` schema and its read grant, the enum types, the tables and their write grants, the covering read index, and pg_partman's monthly partitioning of `transactions` and `user_transaction_overrides` |
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

5. **Run an integration suite.** `npm run test:integration` in either app starts the Postgres image with the init scripts, runs every file in `migrations/`, and tests against the result. CI runs both suites when anything in `migrations/` changes.

### Rules

- **Every database is still rebuilt from empty** (`make clean`), so the four files are edited in place. From the first database that keeps its data, every change is a new file, a changed seed row or a new ruleset included. The runner applies a file only if its journal time is later than the last applied one, so an edit to an applied file never reaches a database that has already run it.
- **Pending files run in one transaction.** A file that fails rolls back everything pending with it, and nothing is recorded, so fix the file and run again. A statement that can't run inside a transaction, such as `CREATE INDEX CONCURRENTLY`, can't be a migration here.
- **Roles are not migrations.** A new role, membership or database belongs in the init scripts, which run before any migration and as the superuser.

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
└── query-plans/             SQL run by hand to study the API's queries; the results are in docs/evidence
```
