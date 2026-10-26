# Transaction Aggregator API

![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1?logo=zod&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle%20ORM-0.45-C5F74F?logo=drizzle&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Keycloak](https://img.shields.io/badge/auth-Keycloak%20JWT-4D4D4D?logo=keycloak&logoColor=white)
![OpenAPI](https://img.shields.io/badge/OpenAPI-Swagger-85EA2D?logo=swagger&logoColor=black)
![Prometheus](https://img.shields.io/badge/Prometheus-metrics-E6522C?logo=prometheus&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-tracing-425CC7?logo=opentelemetry&logoColor=white)
![node:test](https://img.shields.io/badge/tests-node%3Atest-5FA04E?logo=nodedotjs&logoColor=white)
![Testcontainers](https://img.shields.io/badge/integration-Testcontainers-291A3F)
![Biome](https://img.shields.io/badge/Biome-2.5-60A5FA?logo=biome&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-node%3A24--alpine-2496ED?logo=docker&logoColor=white)

This service answers questions about a customer's transactions. It lists them, shows one, totals spending by category or by month, and stores the customer's own category choices. It reads the transactions the consumers stored in PostgreSQL and never changes them.

It is one app in the [transaction-aggregator](../../README.md) monorepo. Every `/api/v1` route needs a Keycloak bearer token.

## Routes

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/api/v1/categories` | `tx:read` | The 16 categories, with their ids and labels |
| GET | `/api/v1/users/{userId}/transactions` | `tx:read` | A page of the customer's transactions in a time window, newest first by default |
| GET | `/api/v1/users/{userId}/transactions/{transactionId}` | `tx:read` | One transaction, with its funding source |
| GET | `/api/v1/users/{userId}/summary` | `tx:read` | Totals for a time window, by category, or by day, week or month with `interval` |
| GET | `/api/v1/users/{userId}/categories` | `tx:read` | Every category as this customer sees it, with any remap |
| GET | `/api/v1/users/{userId}/category-overrides` | `tx:read` | Only the categories this customer has remapped |
| PUT, DELETE | `/api/v1/users/{userId}/category-overrides/{categoryId}` | `tx:write` | Remap a category to another one, or undo it |
| PUT, DELETE | `/api/v1/users/{userId}/transaction-overrides/{transactionId}` | `tx:write` | Re-categorise one transaction, or undo it |
| GET | `/health`, `/ready`, `/metrics` | none | Liveness; readiness, which runs `SELECT 1`; Prometheus metrics |

With `ENABLE_SWAGGER=true`, as in compose, the routes are listed in Swagger at `/docs`. The contract is committed as [`openapi/openapi.json`](openapi/openapi.json), and CI fails if it doesn't match the code.

## How it works

- **Guarded by default.** A hook checks the bearer token before anything else. It must be RS256-signed by Keycloak (checked against its JWKS), with the right issuer and audience.
  - A request without a valid token gets a 401 before its query is parsed.
  - Reads need the `tx:read` scope and writes need `tx:write`.
  - A route skips the check only by declaring itself public.
  - If Keycloak can't be reached, the answer is a 503.
- **The customer is in the path.** The token identifies the calling service, not a customer. The caller, such as the portal's server side, decides which customer it asks about.
- **The customer's category wins.** Every read works out a transaction's category in SQL. The order is:
  1. the customer's override of that transaction;
  2. their remap of its category;
  3. the category the consumer gave it.
- **Writes touch only the customer's choices.** Overrides live in their own tables. The API's database login can't write a transaction or delete a row, so DELETE archives an override instead.
- **Time windows.** The list and the summary need `fromDateTime` and `toDateTime`; `toDateTime` is exclusive.
  - A window may span at most `WINDOW_MAX_DAYS`, 366 by default.
  - A time in the future is taken as now.
  - A category filter must name a known category.
- **Cursor paging.** A page holds up to `limit` rows (1–100, 50 by default).
  - `links.next` and `links.prev` carry an opaque cursor and every filter, so a client follows the link rather than building one.
  - Pages are keyed on time and id, so paging stays as fast however deep it goes.
- **Errors.** Every error is `application/problem+json` (RFC 9457).
  - Its `type` is one of `validation-error`, `invalid-cursor`, `window-too-large`, `unauthorized`, `forbidden`, `not-found` or `auth-unavailable`.
  - A 500 carries the `trace_id` to look up.
- **Observability.**
  - `/metrics` has `http_request_duration_seconds` (by method, route pattern and status), `http_requests_in_flight` and Node's defaults.
  - Each request from a known client logs one audit line with its `client_id`. A client that leaves before its response is logged with status 499.
  - Traces come from the OpenTelemetry auto-instrumentation, which is off unless `OTEL_SDK_DISABLED=false`.

## Layers

There is no service layer. A request passes through three layers, and each one calls only the layer below it:

```text
HTTP request
   │
   ▼
plugins/auth.ts            checks the token and scope, before anything is parsed
   │
   ▼
routes/…/*.route.ts        Zod checks the params, query and body (*.schemas.ts);
   │                       checks the time window and category filter (utils/);
   │                       calls one repository method; turns rows into JSON (*.mappers.ts)
   ▼
repositories/*.ts          all the SQL, written with Drizzle
   │
   ▼
PostgreSQL                 as api_write: reads, and writes only the override tables
```

- **Routes know HTTP:** schemas, status codes, links and problem responses. None touches the pool or Drizzle, apart from `/ready`, which runs `SELECT 1`.
- **Repositories know SQL.** They take plain filter objects and return rows, and none imports Fastify or an HTTP error. A foreign-key violation comes back as `undefined`, and the route decides that it's a 400.
- **Wiring lives in one place.** `container.ts` builds every shared instance once: the pool, Drizzle, the token check and the three repositories. `server.ts` hands them to the routes as options, so nothing creates its own.
### Why not handlers → services → repositories

A common layout puts a service between each handler and its repository. In this API that service would have nothing to do:

- **Each operation is one query, or two.** Every route makes one repository call to answer the request, plus at most one check: that a category filter names real categories, or that a transaction exists before it is overridden. A service per operation would only forward the call, adding a file, a name and a type mapping with no logic of its own.
- **The jobs a service usually does are already done elsewhere.**
  - Validating input: the route's Zod schemas, which also generate the OpenAPI contract.
  - Checking that a referenced category exists: the database's foreign key. A violation becomes a 400.
  - Keeping a request to one customer's data: every query filters on the `userId` in the path.
  - Keeping reads apart from writes: the API's database login can't write a transaction.
- **The one business rule belongs in the query.** Which category wins is worked out in SQL, because the list filters by it and the summary totals by it. In application code, the API would have to load every row in the window before it could filter, total or page them.

A service layer becomes worth having when one of these appears:
- a write that must change several tables in one transaction, such as an audit row saved with the override;
- a second way in that reuses the write logic, such as a command consumer or an admin CLI;
- a route that needs more than two repository calls and branches between them.

The [consumer](../consumer/README.md) is layered into handlers, services and integrations because it has that kind of logic: it turns five source shapes into one row and categorises each one.

## Project structure

```text
apps/api
├── Dockerfile                    node:24-alpine; runs src/app.ts directly, with the OpenTelemetry loader
├── package.json                  scripts, #src/* import alias, madge config
├── biome.json                    lint and format
├── cspell.json                   spelling
├── drizzle.config.ts             drizzle-kit pull from the live database
├── sample.env                    environment for npm start against the make up stack
├── test.env                      Docker socket for Testcontainers
├── openapi/
│   └── openapi.json              the committed contract, generated from the routes
├── scripts/
│   ├── generate-openapi.ts       builds the server from defaults and writes openapi.json
│   └── cleanup-drizzle-pull.ts   tidies drizzle-kit pull output
├── test/
│   ├── fixtures/
│   │   └── sample-records.ts     hand-computed rows and totals for the summary
│   └── integration/
│       ├── database-roles.test.ts    what each database login may and may not write
│       ├── transactions.test.ts      list and detail: filters, window edges, paging, the 404
│       ├── summary.test.ts           exact totals by category and month, with overrides
│       └── helpers/                  test database, seed rows, repositories, server
└── src/
    ├── app.ts                    builds the container and server, listens, shuts down on SIGTERM or SIGINT
    ├── runtime.ts                config, secrets, package info and logger, loaded once
    ├── config.ts                 environment → frozen config (Zod)
    ├── container.ts              Awilix: every shared instance, built once
    ├── server.ts                 Fastify: autoloads the plugins and routes; every error → problem+json
    ├── shutdown.ts               stops taking requests, then closes the pool
    ├── logger.ts                 pino; card numbers always redacted
    ├── auth/
    │   ├── verifier.ts           jose: checks a token against the JWKS, parses its claims, checks scopes
    │   └── test-tokens.ts        real keys and signed tokens for tests
    ├── plugins/                  hooks every route shares, autoloaded
    │   ├── auth.ts               onRequest: no valid token → 401, wrong scope → 403
    │   ├── audit.ts              one log line per request from a known client
    │   └── swagger.ts            OpenAPI from the routes' Zod schemas; Swagger UI at /docs
    ├── routes/                   the HTTP layer, autoloaded; the folders are the URL (_userId → :userId)
    │   ├── health.route.ts       GET /health
    │   ├── ready.route.ts        GET /ready, runs SELECT 1
    │   ├── metrics.route.ts      GET /metrics
    │   ├── checks.schemas.ts     /health and /ready response shapes
    │   └── api/v1/
    │       ├── categories/                  GET /api/v1/categories
    │       └── users/_userId/
    │           ├── transactions/
    │           │   ├── list-transactions.route.ts   GET …/transactions
    │           │   ├── get-transaction.route.ts     GET …/transactions/:transactionId
    │           │   ├── transactions.schemas.ts      query, params and responses (Zod)
    │           │   └── transactions.mappers.ts      rows → response items and cursors
    │           ├── summary/                 GET …/summary
    │           ├── categories/              GET …/categories
    │           ├── category-overrides/      GET the remaps; PUT and DELETE one
    │           └── transaction-overrides/   PUT and DELETE a transaction's category
    ├── integrations/database/    the data layer
    │   ├── pool.ts               pg Pool; isForeignKeyViolation
    │   ├── query-logger.ts       optional SQL and EXPLAIN logging
    │   ├── repositories/         all the SQL, one class per area
    │   │   ├── transaction-repository.ts   list, detail, set and archive a transaction's category
    │   │   ├── summary-repository.ts       totals by category or by period
    │   │   └── category-repository.ts      categories, a customer's remaps, unknown slugs
    │   └── schemas/              Drizzle tables, pulled from the database
    ├── schemas/                  Zod the routes share: problems, links, cursors, windows, enums
    ├── errors/
    │   ├── http-problem.ts       HttpProblem and one factory per problem type
    │   └── auth-errors.ts        jose errors → 401, or 503 when the keys can't be fetched
    ├── telemetry/
    │   ├── metrics.ts            Prometheus registry: request duration, requests in flight
    │   └── http-metrics.ts       records each request by route pattern; 499 for a client that left
    └── utils/
        ├── paging.ts             keyset pages, opaque cursors, next and prev links
        ├── time-window.ts        rejects a window wider than WINDOW_MAX_DAYS
        ├── category-filter.ts    rejects an unknown category slug
        ├── trace-id.ts           the request's trace id, for a 500
        └── secrets.ts            reads each secret from a file in SECRET_DIR
```

The other route folders follow the `transactions/` pattern: one `*.route.ts` per operation, the folder's Zod shapes in `*.schemas.ts`, and its row-to-JSON functions in `*.mappers.ts`. A folder leaves out a file it doesn't need: `category-overrides/` reuses the shapes from `users/_userId/categories/`. Each unit test (`src/**/*.test.ts`) sits next to the file it tests; the tree leaves them out.

## Configuration

All configuration comes from environment variables, validated at startup by [`src/config.ts`](src/config.ts). The database password is never in the environment: `DATABASE_PASSWORD_SECRET_NAME` names a file in `SECRET_DIR`. The variables that change behaviour:

| Variable | Default | Effect |
| --- | --- | --- |
| `HTTP_PORT` | `3000` | HTTP port; compose uses `8083` |
| `ENABLE_SWAGGER` | `false` | Serves Swagger at `/docs` |
| `LOG_LEVEL` | `info` | `debug` also logs each pool connection taken and returned |
| `LOG_REDACTED_FIELDS` | empty | Comma-separated fields to redact, on top of the card number fields |
| `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` | `localhost` / `5432` / `txn_agg` | Where Postgres is |
| `DATABASE_USER` | `api_write` | Can read, and write only the override tables |
| `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` | `3` / `10` | Postgres pool size |
| `DATABASE_IDLE_TIMEOUT_MS` / `DATABASE_CONNECTION_TIMEOUT_MS` | `30000` / `10000` | Close an idle connection after; give up opening one after |
| `DATABASE_STATEMENT_TIMEOUT_MS` / `DATABASE_QUERY_TIMEOUT_MS` | `5000` / `6000` | The server cancels a statement after; the client fails a query after. Keep the statement timeout lower |
| `DATABASE_KEEP_ALIVE_DELAY_MS` | `10000` | Idle time before TCP keep-alive probes a connection |
| `DATABASE_QUERY_LOG_SQL` | `false` | Logs each statement with its values filled in |
| `DATABASE_QUERY_LOG_PLAN` | `false` | Logs each statement with its plan; a read runs a second time under `EXPLAIN ANALYZE` |
| `AUTH_JWKS_URI` / `AUTH_ISSUER` / `AUTH_AUDIENCE` | `keycloak:8086` URLs / `txn-api` | Where the token keys come from, and what the token must say. Compose and `sample.env` set the URLs that work there. |
| `WINDOW_MAX_DAYS` | `366` | Widest time window for the list and the summary |

## Running it

The API runs from the repo root as part of the stack, on http://localhost:8083:

```sh
make up
```

The root README's [Call the API](../../README.md#call-the-api) shows how to get a token and make a request.

To run it from the host against that stack:

```sh
cp sample.env .env    # already points at the make up stack, on port 3000
npm install
npm start
```

Under `make up-all`, Grafana takes port 3000, so change `HTTP_PORT` in `.env`. Node 24 strips the TypeScript types itself, so nothing is built and the Docker image runs `src/app.ts` as it is.

| Script | What it does |
| --- | --- |
| `npm start` | Runs the API with `.env`, restarting on changes and pretty-printing the logs |
| `npm run test:unit` | Unit tests (`node:test`) |
| `npm run test:integration` | Integration tests against Postgres in a container (needs Docker) |
| `npm run check` | `tsc` |
| `npm run precheck` | Import-cycle check (madge) |
| `npm run lint` | Biome lint and spelling (cspell) |
| `npm run fms` | Biome migrate, lint, format, then type check |
| `npm run generate-contract` | Regenerates `openapi/openapi.json` from the routes |
| `npm run drizzle:pull-schema` | Regenerates the Drizzle tables from the live database |
| `npm run lib:audit` | Dependency audit (`audit-ci`) |

To see how the API holds up under realistic traffic, run `make load` from the repo root. The [load test's README](../../loadtests/README.md) explains it.

## Testing

**Unit tests** (`npm run test:unit`) sit next to the code they test. They call routes through Fastify's `inject`, with fake repositories, and sign tokens with a local test key, so nothing needs to be running.

**Integration tests** (`npm run test:integration`) send requests through the API to a real PostgreSQL 18, started by Testcontainers.
- Each test file gets a fresh database, built the way compose builds it: the repo's Postgres image, its `initdb` scripts, and every migration.
- The API connects as `api_write`, its own login, so a missing grant fails the test just as it would in production.
- The real token check runs, trusting a test key pair.

| Test file | What it checks |
| --- | --- |
| `database-roles.test.ts` | `api_write` can't change a transaction or add a category, and can only archive an override. `kafka_consumer` can insert transactions but never delete one, and can't touch a customer's choices. |
| `transactions.test.ts` | Each filter, both edges of the time window, a walk forward and back through pages of rows 1 µs apart, the same 404 for another customer's transaction as for a missing one, and the detail of a transaction stored long after it happened |
| `summary.test.ts` | Exact totals against hand-computed sample rows, by category and by month, with and without a remap and a transaction override |

The integration tests need Docker. `test.env` points Testcontainers at Rancher Desktop's Docker socket. With any other Docker setup, edit or empty it, but keep the file: `node --env-file` fails if it's missing.
