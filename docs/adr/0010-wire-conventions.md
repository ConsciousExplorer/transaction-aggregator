# 0010. Money, categories and date windows on the wire

- **Status:** Accepted
- **Where it lives:** [`schemas/common.ts`](../../apps/api/src/schemas/common.ts), [`schemas/transactions.ts`](../../apps/api/src/schemas/transactions.ts), [`time-window.ts`](../../apps/api/src/utils/time-window.ts), [`category-filter.ts`](../../apps/api/src/utils/category-filter.ts), [`http-problem.ts`](../../apps/api/src/errors/http-problem.ts), [`openapi.json`](../../apps/api/openapi/openapi.json)
- **Related:** [0001](0001-avro-schema-registry-contract.md) (the same conventions on Kafka), [0009](0009-keyset-paging.md)

## Context

These are the API's public contract, and CI fails a pull request into `main` that breaks them ([0007](0007-routes-and-repositories.md)). Each one is cheap to get right now and expensive to change once clients depend on it.

## Decision

**Field names are camelCase.**

**Money is an object of integer minor units.**

- Every amount in every response is `{amountMinor, currency}`, such as `{amountMinor: 12550, currency: "ZAR"}`. That covers list items, detail and summary totals.
- An amount never travels apart from its currency.
- **Amounts are positive.** Whether money came in or went out is `creditDebitIndicator`, `credit` or `debit`, from the account holder's side: ISO 20022's name for it, also used by UK Open Banking. In the summary it's in the field name: `debit.total`, `credit.total`.
- **The one signed figure is the summary's `netAmount` = credit − debit,** because a difference is naturally signed.
- **The amount filters** `amountMin` and `amountMax` are plain integers in minor units.
- **The database holds one currency, ZAR,** so the summary has no currency dimension.

**Categories are read as slugs and written as ids.**

- `GET /api/v1/categories` returns `{categoryId, category, label}` for all 16.
- A category's id is called `categoryId` wherever it appears, `mappedTo.categoryId` included. The per-user category endpoints said `id` until they were renamed before the first release.
- Responses carry the stable slug (`category`, such as `"groceries"`). The slug never changes; a new display name changes `label`.
- The list's `category` filter takes slugs, and an unknown slug is a 400 `validation-error`.
- **Writes send the numeric id.** The seed pins every id, so ids are the same in every environment and are never reused.
  - The database's foreign key is the validator: Postgres's error 23503 becomes a 400 `validation-error`.
  - The handler checks `from ≠ to` before the database's CHECK does.

**Date windows are bounded.**

- `fromDateTime` and `toDateTime` are ISO 8601, and `toDateTime` is exclusive. A future value is clamped to now.
- The window may be at most 366 days, on the list and the summary alike (`WINDOW_MAX_DAYS`). Anything longer is a 400 `window-too-large`.
- 366 days fits any twelve calendar months, leap day included, so a year's trend is one summary call. The list matches it, so every summary figure opens as the transactions behind it, with the same parameters.

**Errors are RFC 9457 problem details** (`application/problem+json`) from one typed catalog. The `type` is a short slug, such as `validation-error`, `invalid-cursor` or `window-too-large`. A 500 carries its `trace_id`.

**Only `completed` transactions count in the summary.** The list and detail show every status.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Decimal strings or floats for money | Floats can't hold cents exactly. Integers of minor units are the industry's answer. |
| Signed amounts | The sign depends on whose side you take (Plaid's "positive = money out" is a known source of client bugs), and it would duplicate `creditDebitIndicator`. |
| `currency` once in `meta` | Every amount would depend on a field elsewhere in the payload. |
| Numeric category ids on reads | Every client would need the id-to-name table just to render a row. |
| Slugs on writes | The API would look up an id the client had already looked up from the same `GET /categories`. |
| 92 days on the list and 366 on the summary | A twelve-month figure would need four list calls stitched together, and there would be two settings to keep in step. |
| 18 months (all of retention) | A daily summary would be 548 buckets × 16 categories in one unpaged response. |

## Consequences

- **Clients never do float maths on money:** amounts are exact integers.
- **Category ids are append-only:** renumbering or reusing one is a breaking change.
- **A year is the most one request can read,** so an older history means stepping the window back.

## Open

- **Problem `type` values are bare slugs:** RFC 9457 allows a relative reference, but recommends absolute URIs. Decide before the first release whether they become `urn:txn-agg:problem:<slug>` or stay as they are.
- **Positivity is enforced by the database only:** the response schema describes amounts as positive but doesn't check it. The database's `CHECK (amount_minor > 0)` is what enforces it.
