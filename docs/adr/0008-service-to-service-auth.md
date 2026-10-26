# 0008. Service-to-service auth: the calling app chooses the user

- **Status:** Accepted
- **Where it lives:** [`verifier.ts`](../../apps/api/src/auth/verifier.ts), [`plugins/auth.ts`](../../apps/api/src/plugins/auth.ts), [`plugins/audit.ts`](../../apps/api/src/plugins/audit.ts), [`txn-api-realm.json`](../../infrastructure/keycloak/txn-api-realm.json), the portal's BFF in [`apps/portal/src/bff`](../../apps/portal/src/bff)
- **Related:** [0006](0006-database-roles-enforce-writes.md)

## Context

The API is an internal system API. Its callers are other apps, such as a bank's portal backend or a service that reads transactions, not people with browsers.

The end user signs in to the calling app, not to this API. That app knows who the user is, and this API doesn't.

## Decision

**Callers authenticate as apps, with OAuth 2.0 client credentials from Keycloak.**

- **Clients:**
  - `banking-portal` has `tx:read` and `tx:write`.
  - `banking-service` has `tx:read` only.
  - `ops-console` has `ops`, which no route uses yet.
  - Access tokens last 15 minutes.
- **Verification:** the API verifies every token in an `onRequest` hook against Keycloak's published keys (JWKS). It requires RS256, the realm's issuer, the `txn-api` audience and an expiry.
- **Errors:** a request with no valid token gets a 401 before its query or body is parsed. If Keycloak's keys can't be fetched, the API answers 503.
- **Guarded by default:** every route needs a token unless it opts out. Only `/health`, `/ready`, `/metrics` and the docs opt out.
- **Scopes:** each route declares the scope it needs. Reads need `tx:read` and writes need `tx:write`, and a missing scope is a 403. `route-scopes.test.ts` checks every route.
- **The calling app is the `azp` claim:** the client id that asked for the token. Keycloak's `sub` for a client is an opaque service-account id that changes when the realm is imported again.

**The user is named in the path, and the API trusts the caller to name the right one.** Every user route is `/api/v1/users/{userId}/…`, and every query is scoped by that `user_id`. A request can't reach another user's rows through a transaction id, but the API does not check that the caller may act for that user.

**The portal shows the intended shape:**

1. The user signs in to the portal through Keycloak (authorisation code with PKCE).
2. The portal's backend reads `customer_id` from the ID token and keeps it in a sealed session cookie.
3. It calls the API with its own client-credentials token, putting that id in the path.

**One audit line per authenticated request** records `client_id` (from `azp`), `user_id` (from the path), method, route pattern, status and trace id. It is an allowlist of fields, so nothing else reaches it by accident.

**Rate limiting belongs to the gateway in front of the API, not to the API.** The API protects its database with capacity limits instead:

- a pool of at most 10 connections;
- a 5-second statement timeout;
- at most 100 rows a page;
- a 366-day window ([0010](0010-wire-conventions.md)).

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Forward the user's own token to the API | The API would depend on the end-user login, and `customer_id` would have to go into access tokens. Callers with no user, such as batch jobs, would need a second path. |
| `/me` routes | A client-credentials token has no user in it. |
| `sub` as the client's identity | In Keycloak it's an opaque id that changes when the realm is imported again. |
| A shared-secret (HS256) token issuer | Every service would hold the signing secret. The keys published by Keycloak (JWKS) need no shared secret. |
| Rate limiting inside the API | The counters would reset on every restart and multiply with replicas, and it duplicates the gateway's job. |
| mTLS between services | It needs certificate infrastructure the system doesn't have, and it still identifies the app, not the user. |

## Consequences

- **The trust is coarse:** any client with `tx:read` can read any user's transactions, and any client with `tx:write` can change any user's preferences. The scopes say what an app may do, not to whom.
- **The audit line records a claim:** its `user_id` is what the caller said, not proof of who the user was.
- **There is no per-client fairness without a gateway:** with no gateway in front, one misbehaving client can hold every pool connection. The pool caps total load, not who gets it.
- **Dev secrets are committed:** the client secrets are in the realm export and in compose, as committed dev credentials.

## Revisit when

- **A caller the API can't fully trust appears:** make the token name the user. The production path is OAuth token exchange (RFC 8693): the portal swaps the user's token for one scoped to that user, and the API checks the path's `userId` against it.
- **The API scales out with no gateway:** add a rate limit keyed on the verified client id, after auth, with a shared store.
