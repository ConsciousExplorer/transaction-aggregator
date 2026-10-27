# 0007. API routes call repositories directly; Zod is the one contract source

- **Status:** Accepted
- **Where it lives:** [`apps/api/src/routes`](../../apps/api/src/routes), [`repositories/`](../../apps/api/src/integrations/database/repositories), [`container.ts`](../../apps/api/src/container.ts), [`server.ts`](../../apps/api/src/server.ts), [`generate-openapi.ts`](../../apps/api/scripts/generate-openapi.ts), [`openapi.json`](../../apps/api/openapi/openapi.json), [`api-contract.yml`](../../.github/workflows/api-contract.yml)
- **Related:** [0004](0004-versioned-rules-read-time-overrides.md) (the rule that lives in SQL), [0010](0010-wire-conventions.md)

## Context

The API has ten operations. Six are reads, and each read is one query shaped for its response. The only business rule with any weight is the user's effective category, which has to be computed in SQL ([0004](0004-versioned-rules-read-time-overrides.md)).

The contract (request validation, response shape, OpenAPI document) has to stay in step with the code, and a breaking change has to be caught before it reaches `main`.

## Decision

**Two layers: routes, then repositories.**

- **Routes** are autoloaded from `src/routes`, where the folder path is the URL (`_userId` becomes `:userId`). Each operation has its own `*.route.ts`. The folder's response shapes and row-to-wire mappers sit beside it in `<folder>.schemas.ts` and `<folder>.mappers.ts`.
- **Repositories** are classes in `src/integrations/database/repositories`, and they own all the SQL. `transaction-conditions.ts` holds the filter and effective-category joins that the list, the detail and the summary share.
- **A handler** validates, makes its checks, calls a repository and maps the result. Checks used by more than one route live in `utils/`, such as `assertWindowWithin` and `assertKnownCategories`.
- **Each route** declares only the repository methods it calls, as `Pick<Repository, "method">`, so a test passes a fake with just those methods.
- **An Awilix container** builds the graph once at boot (`container.ts`). `app.ts` spreads it into `buildServer` as a `ServerDependencies`, so a missing dependency is a compile error.

**Zod schemas are the one source for validation, serialisation and the OpenAPI document.**

- `@fastify/type-provider-zod` compiles each route's schemas into its validator and its response serialiser.
- `npm run generate-contract` writes `openapi/openapi.json` from the same schemas, and the file is committed.
- **Checked in CI:** the `api-contract` workflow regenerates the file and fails on any diff. On a pull request into `main`, oasdiff also fails on a breaking change against `main`'s contract.

## When a service layer becomes worth it

None of these has happened yet. Any one of them is reason enough:

1. A write must span tables atomically, such as an audit or outbox row committed with an override.
2. A second transport needs the write logic: a Kafka command consumer, or an admin CLI.
3. A business rule spans several entities, such as remap chains or override quotas.
4. A handler grows past two repository calls with branching between them.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A service layer now | Most operations would be one-line pass-throughs, and the main rule can't move out of SQL anyway. Validation belongs to Zod, integrity to foreign keys, and ownership to the `user_id` in every query, so a service would have nothing left to own. |
| Hexagonal (domain, application, infrastructure) | A hexagon around an empty core. The consumer has real domain code and is layered; the API isn't. |
| Feature modules | The URL tree is already the routing, and the units don't split by feature: one repository serves both the transaction routes and the override routes. |
| Express | Zod as validator, serialiser and OpenAPI source is a Fastify type-provider feature. On Express it takes three libraries and glue. |
| NestJS | Its dependency injection needs decorator metadata, which Node's built-in TypeScript type stripping can't produce. It would bring back a build step. |
| A hand-written OpenAPI file | It drifts from the code with the first change nobody remembers to copy. |

## Consequences

- **A route reads top to bottom:** its SQL is one call away, and its test fakes one or two methods.
- **One schema change updates three things:** changing a Zod schema changes validation, the response and `openapi.json` together, and CI shows the diff.
- **Unlisted fields are dropped:** Fastify's serialiser drops any response field the schema doesn't list. That once removed the trace id from every 500 response without an error.
- **The override PUTs are two statements, not one transaction:**
  - The transaction override reads the transaction (its owner and `occurred_at`), then upserts.
  - The category override upserts, then reads the names back.
  - This is safe because facts never change and each upsert is atomic. The worst case is two PUTs racing, and the last write wins.
- **Write orchestration sits in handlers:** it would move to a service the day one of the triggers above happens.

## Revisit when

Any trigger in "When a service layer becomes worth it" happens.
