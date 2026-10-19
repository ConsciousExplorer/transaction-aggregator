# Transaction portal (demo)

> **This is a demo app.** It exists to showcase the [transaction-aggregator](../../README.md) backend: the API's reads, paging and overrides, Keycloak sign-in, and the backend-for-frontend (BFF) pattern the API was designed to sit behind. It is not a product and is not hardened for production.

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Keycloak](https://img.shields.io/badge/Keycloak-OIDC%20%2B%20PKCE-4D4D4D?logo=keycloak&logoColor=white)
![iron-session](https://img.shields.io/badge/session-iron--session-6C757D)
![jose](https://img.shields.io/badge/JWT-jose-000000?logo=jsonwebtokens&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-4-3E67B1?logo=zod&logoColor=white)

A customer signs in and sees their own money:

- **Overview**: money in and out for 1, 3 or 12 months, spending by category, and money in and out by month. A category or a month opens the matching transactions.
- **Transactions**: filter by type, category and direction; sort; choose a page size; and page with the API's cursors. Re-categorise any transaction, or reset it to the bank's category.
- **Categories**: remap a whole category to another, or remove the remap.

Every view reads the API's *effective* category, so a re-categorisation or remap shows everywhere at once.

## How it works: the BFF

The portal is one Next.js app with two halves. The browser runs React pages; the server side, under `/bff/*`, is the BFF. The browser only ever talks to the BFF, on its own origin.

```
Browser ──session cookie──▶ BFF (/bff/*) ──Bearer service token + traceparent──▶ API :8083
                              │
                              ├─ code flow + PKCE (the person) ──────────▶ Keycloak
                              └─ client credentials (banking-portal) ────▶ Keycloak
```

There are two identities, and they never mix:

- **The person** signs in through Keycloak (client `banking-portal-web`, authorization-code flow with PKCE). Their ID token carries a `customer_id` claim. The BFF verifies the token, then keeps the customer id and name in a session cookie that is sealed (encrypted and signed), `httpOnly` and `SameSite=Lax`. There is no server-side session store, so the BFF stays stateless.
- **The service** is the BFF itself, calling the API as `banking-portal` with a client-credentials token (`tx:read tx:write`). It caches that token until shortly before it expires.

The rule that makes this safe: **the `{userId}` in every API path comes from the session, never from the browser.** The API lets any `tx:read` caller read any user, by design. The BFF is what ties a signed-in person to their own customer id. A `userId` query parameter sent to the BFF is simply dropped.

**Why the browser holds no token the API accepts.** The token the API accepts is the service's, and it can read every customer, so it can't go to a browser. Giving the browser the person's own token instead would mean per-user authorization and CORS inside the API, which the backend's design rules out. A token in the browser can also be read by any script on the page, so a single cross-site-scripting bug would leak it, while an `httpOnly` cookie can't be read from JavaScript.

One token does pass through the browser: on sign-out, the person's ID token travels to Keycloak as `id_token_hint` in the address bar, so Keycloak can end the session without asking. That is how OpenID Connect logout works, and the token is useless against the API: its audience is the portal's sign-in client, not `txn-api`, and it carries no scopes, so the API answers 401.

**What the BFF sends the API.** Every call carries three headers: `Authorization: Bearer <service token>`, a fresh W3C `traceparent`, and `accept: application/json`. The API logs the trace id on its audit line, alongside `client_id: banking-portal` and the customer's `user_id`. When something fails, the page shows that trace id as its reference, so the request can be found in the API's logs and in Tempo.

**Writes** (re-categorise, remap) also check that the request's `Origin` is the portal's own, on top of `SameSite=Lax`. Sign-out is a `POST` for the same reason, and it ends the Keycloak session too.

**Paging.** The API answers a list page with `links.next` and `links.prev`. The BFF hands the browser only the cursor from each link, never the API's URL. When the browser follows a cursor, it also keeps the exact date window the first page was read with, just as the API's own links do, so the pages never shift mid-walk.

## Demo customers

Each is one of the seeded customers the producers generate. The customer pool is seeded, so these ids exist on every `make up`.

| Customer | Username | Password |
| --- | --- | --- |
| John Doe | `john.doe` | `portal-password` |
| Jane Doe | `jane.doe` | `portal-password` |
| Richard Roe | `richard.roe` | `portal-password` |

Signing in as a realm user with no customer behind them, such as `kafka-admin`, signs you straight back out with a message.

## Running it

With the rest of the system, from the repo root:

```sh
make up      # the portal is in the ui profile, on by default
```

Then open http://localhost:8084.

On its own, against a stack that `make up` already started:

```sh
cp sample.env .env    # local-dev values; next dev reads .env
npm install
npm run dev           # http://localhost:8084
```

Stop the `portal` container first (`docker stop portal`), since both use port 8084.

> **Keycloak only imports the realm into an empty database.** The portal's client and the demo customers are in [txn-api-realm.json](../../infrastructure/keycloak/txn-api-realm.json). If your stack's Keycloak data predates them, sign-in fails with "client not found". Run `make clean`, then `make up`, to start from empty. The seeded data comes back the same.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server on port 8084 |
| `npm run build` | Production build (standalone output, used by the Dockerfile) |
| `npm run test:unit` | Unit tests (`node:test`) for the pure helpers |
| `npm run check` | Type check (`tsc`) |
| `npm run lint` / `npm run format` | Biome |

## Configuration

All from the environment, validated with Zod on each request ([src/bff/config.ts](src/bff/config.ts)). [sample.env](sample.env) has the local values, and the compose file has the container's.

| Variable | What it is |
| --- | --- |
| `PUBLIC_BASE_URL` | Where the browser reaches the portal; redirects and the `Origin` check use it |
| `API_BASE_URL` | The transaction API |
| `KEYCLOAK_PUBLIC_URL` | Keycloak as the browser sees it, and the token issuer |
| `KEYCLOAK_INTERNAL_URL` | Keycloak as the BFF reaches it (inside Docker, `http://keycloak:8080`) |
| `KEYCLOAK_REALM` | `txn-api` |
| `PORTAL_CLIENT_ID` / `PORTAL_CLIENT_SECRET` | The person's sign-in client |
| `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` | The BFF's own identity towards the API |
| `SESSION_SECRET` | Seals the session cookie; at least 32 characters |

## Layout

```text
src/
├── app/
│   ├── page.tsx                 sign-in page
│   ├── (portal)/                the signed-in shell, and the overview, transactions and categories pages
│   └── bff/                     the BFF's routes
│       ├── auth/                login, callback, logout
│       └── me, categories, summary, transactions (+ the two write routes)
├── bff/                         server-only: config, session, Keycloak, the API client, problems
├── components/                  the three views and their parts
└── lib/                         shared by browser and BFF: types, money, dates, summaries, the browser's BFF client
```

Each `*.test.ts` sits next to the file it tests.
