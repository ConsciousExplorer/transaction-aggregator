# Auth refactor: split token verification from Fastify, default-closed routing

> **Status: design only. No code has been changed as part of writing this document.** This is a plan for you to implement — see [[feedback-docs-not-source]].

---

## 0. Grounding: what's actually in the codebase today

Before proposing anything, here's the real current state, read directly from the source:

- **`apps/api/src/utils/auth.ts` is a one-line stub, not a working verifier:**
  ```ts
  import { createRemoteJWKSet, jwtVerifier } from "jose";
  ```
  This doesn't compile as-is — `jose` has no export named `jwtVerifier` (the real export is `jwtVerify`). There is no `verifyToken`, no `AuthContext`, no error handling here yet. This refactor is being designed against a blank slate, not an existing implementation to preserve.
- **`apps/api/src/config.ts` already has the real config surface this refactor needs**: `AUTH_JWKS_URI`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, all zod-validated, exposed as `config.auth.{jwksUri, issuer, audience}`. Nothing here needs to change.
- **No `plugins/auth.ts` exists.** `apps/api/src/plugins/` currently holds exactly one file, `swagger.ts`.
- **No route anywhere references `verifyBearerToken`, `requireScope`, or `authContext`.** Every route in the API is unauthenticated today — confirmed by grep, not assumed.
- **`apps/api/src/errors/problems.ts` already has `unauthorized()`** (401, `type: "unauthorized"`) and `forbidden()` (403) — this refactor reuses these, it doesn't invent new error shapes.
- **`apps/api/src/server.ts`** wires two `@fastify/autoload` calls: `pluginAutoLoadParameters` (dir: `plugins/`) registers before `routeAutoLoadParameters` (dir: `routes/`) — this ordering is what makes a root-level decorator from a plugin visible to every autoloaded route (see `fastify-explained.md` in this same folder for why that ordering matters).

---

## 1. Summary

Split today's (nonexistent, but planned) JWT verification into two layers:

1. **A pure core** (`auth/verifier.ts`) — no Fastify import at all. Given a raw token string, it either returns a validated `AuthContext` or throws one of a small set of typed, non-HTTP errors. This is unit-testable with zero HTTP machinery: no `fastify.inject()`, no running server, just calling a function with a string.
2. **A thin Fastify adapter** (`plugins/auth.ts`) — the only place that knows about `Authorization` headers, Fastify decorators, or HTTP status codes. It calls into the pure core and translates every possible failure into the *same* `unauthorized()` Problem, logging the real reason at `warn` before doing so.
3. **Default-closed routing** — a global `preHandler` hook (registered by the auth plugin, at root) that runs on every request unless the route explicitly opts out via `config.public: true`. This flips the failure mode: a route that forgets to declare its auth requirement is *rejected* by default, not silently open.

---

## 2. Motivation

**Testability of the pure core.** A `createTokenVerifier(config).verifyToken(token)` function that never touches `FastifyRequest`/`FastifyReply` can be unit-tested with nothing but a signed test JWT and a plain function call — no `buildServer()`, no injected HTTP request, no mocking Fastify's request/reply objects at all. The negative-matrix cases (bad signature, expired, wrong `iss`, wrong `alg`, missing claims) become fast, isolated unit tests instead of integration tests, which is both quicker to run and easier to reason about when one fails — a failing unit test on `verifyToken` points at exactly one function, not at "something in the HTTP pipeline."

**Uniform-401 discipline stays in exactly one place.** If error-to-HTTP-status mapping were scattered across the verifier itself, it would be easy for one code path to accidentally leak a distinguishing detail (a different status code, a different response shape, a stack trace) for "bad signature" versus "expired" versus "wrong audience" — which is precisely the kind of information-leak `research/api-auth.md` §9's BOLA/enumeration-leak discipline warns against generalizing from (there, it's about not distinguishing "wrong user" from "doesn't exist"; here it's the same principle applied to "why did auth fail"). By making the adapter the *only* place that constructs an HTTP response, that invariant is enforced by the file's structure, not by every call site remembering to collapse errors correctly.

**Fail-closed routing.** Today, adding a new route means auth is opt-in by construction — nothing stops a new route file from simply not knowing it needs a `preHandler`, and the failure mode of forgetting is "wide open," which is the worst possible default for a project modeled on a bank's data. A global hook that runs unless a route explicitly declares itself public inverts that: the failure mode of forgetting becomes "route is unreachable without a token," which is loud, immediate, and safe — you'll notice a route 401ing in testing long before you'd notice a route being silently unauthenticated in production.

---

## 3. Current vs. target

### Current (does not compile, not wired anywhere)

```ts
// apps/api/src/utils/auth.ts
import { createRemoteJWKSet, jwtVerifier } from "jose";
```

Nothing else exists. No route has any auth check.

### Target

```ts
// apps/api/src/auth/verifier.ts — NO fastify import anywhere in this file
export function createTokenVerifier(config: AuthConfig) {
	const jwks = createRemoteJWKSet(new URL(config.jwksUri));
	return {
		async verifyToken(token: string): Promise<AuthContext> {
			// jose verification, then typed rejects — see §4 for the real code
		}
	};
}
```

```ts
// apps/api/src/plugins/auth.ts — fastify-plugin wrapped, name "auth"
export default fastifyPlugin(
	async (server, opts) => {
		const verifier = createTokenVerifier(opts.authConfig);

		server.decorate("verifyBearerToken", async (request) => {
			// parse header, call verifier.verifyToken, map every failure to unauthorized()
		});

		server.addHook("preHandler", async (request, reply) => {
			if (request.routeOptions.config?.public) return;
			await server.verifyBearerToken(request);
		});
	},
	{ name: "auth" }
);
```

```ts
// any route that should stay open
fastify.route({
	method: "GET",
	url: "/health",
	config: { public: true },
	handler: async (_req, reply) => reply.send({ status: "ok" })
});
```

---

## 4. File-by-file change list

### 4.1 New: `apps/api/src/auth/verifier.ts`

No Fastify import. Holds the `createRemoteJWKSet` instance in a closure so it's created once and reused (matching the existing `database` singleton pattern in `container.ts`, which builds the pg pool once via `asFunction(...).singleton()`).

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

export type AuthConfig = {
	jwksUri: string;
	issuer: string;
	audience: string;
};

export type AuthContext = {
	clientId: string; // JWT `sub` — which SERVICE is calling, never an end-user
	scope: string[];
};

// Distinct, typed, non-HTTP errors — the adapter (plugins/auth.ts) is the
// only place allowed to know these map to a 401. A test on verifyToken
// asserts on `error instanceof TokenVerificationError` and, where it matters,
// on `.reason`, never on an HTTP status code — this file has no concept of one.
export class TokenVerificationError extends Error {
	constructor(
		message: string,
		readonly reason:
			| "malformed"
			| "signature"
			| "expired"
			| "issuer"
			| "audience"
			| "algorithm"
			| "missing-claims"
	) {
		super(message);
	}
}

export function createTokenVerifier(config: AuthConfig) {
	const jwks = createRemoteJWKSet(new URL(config.jwksUri));

	return {
		async verifyToken(token: string): Promise<AuthContext> {
			let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];

			try {
				// algorithms pinned explicitly — never let the verifier accept
				// whatever `alg` the token's own header claims (research/api-auth.md
				// §10.2's "alg confusion" attack). issuer/audience checked here,
				// exactly as the prior design specced — unchanged by this refactor.
				({ payload } = await jwtVerify(token, jwks, {
					issuer: config.issuer,
					audience: config.audience,
					algorithms: ["RS256"]
				}));
			} catch (err) {
				// jose throws distinct subclasses (JWTExpired, JWSSignatureVerificationFailed,
				// JWTClaimValidationFailed for iss/aud, JOSEAlgNotAllowed for alg) —
				// mapped here to this module's own typed error so callers never
				// need to import jose's error classes directly.
				throw mapJoseError(err);
			}

			const { sub, scope } = payload;
			if (typeof sub !== "string" || typeof scope !== "string") {
				throw new TokenVerificationError(
					"Token missing required string claims (sub, scope)",
					"missing-claims"
				);
			}

			return {
				clientId: sub,
				// Keycloak's scope claim is a space-separated string
				// (research/api-auth.md §4.3), never an array or comma list.
				scope: scope.split(" ")
			};
		}
	};
}

function mapJoseError(err: unknown): TokenVerificationError {
	const name = err instanceof Error ? err.name : "";
	if (name === "JWTExpired")
		return new TokenVerificationError("Token expired", "expired");
	if (name === "JWSSignatureVerificationFailed")
		return new TokenVerificationError("Bad signature", "signature");
	if (name === "JOSEAlgNotAllowed")
		return new TokenVerificationError("Disallowed algorithm", "algorithm");
	if (name === "JWTClaimValidationFailed") {
		// jose's message text distinguishes iss vs aud failures; inspect it
		// rather than re-deriving the claim check ourselves.
		const message = err instanceof Error ? err.message : "";
		if (message.includes("aud"))
			return new TokenVerificationError("Wrong audience", "audience");
		return new TokenVerificationError("Wrong issuer", "issuer");
	}
	return new TokenVerificationError("Malformed token", "malformed");
}
```

**Open question flagged here, not resolved:** relying on substring-matching jose's error `.message` to distinguish `iss` vs `aud` inside one shared `JWTClaimValidationFailed` class is a little fragile against a jose version bump changing wording. See §7.

### 4.2 New: `apps/api/src/plugins/auth.ts`

`fastify-plugin`-wrapped (so its decorator and hook apply to the *parent* scope — i.e. the whole app — not just this plugin's own children; see `fastify-explained.md` §2 for why that wrapper is what makes this visible everywhere). Named `"auth"` for clarity in Fastify's plugin introspection tools.

```ts
import { fastifyPlugin } from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { unauthorized } from "#src/errors/problems.ts";
import {
	createTokenVerifier,
	type AuthConfig,
	type AuthContext
} from "#src/auth/verifier.ts";

declare module "fastify" {
	interface FastifyInstance {
		verifyBearerToken(request: FastifyRequest): Promise<void>;
	}
	interface FastifyRequest {
		authContext?: AuthContext;
	}
	interface FastifyContextConfig {
		// Explicit opt-out for routes that must stay reachable without a
		// token (health checks, docs). Absent/false means "protected" —
		// the enforcement hook below treats undefined as closed, not open.
		public?: boolean;
	}
}

export default fastifyPlugin<{ authConfig: AuthConfig }>(
	async (server, opts) => {
		const verifier = createTokenVerifier(opts.authConfig);

		server.decorate(
			"verifyBearerToken",
			async function verifyBearerToken(request: FastifyRequest) {
				const header = request.headers.authorization;

				if (!header?.startsWith("Bearer ")) {
					request.log.warn(
						{ reason: "missing-or-malformed-header" },
						"auth rejected"
					);
					throw unauthorized();
				}

				const token = header.slice("Bearer ".length);

				try {
					request.authContext = await verifier.verifyToken(token);
				} catch (err) {
					// This is the ONLY place a verification failure becomes an
					// HTTP response — every reason (expired, bad signature, wrong
					// iss/aud, wrong alg, missing claims) collapses to the same
					// unauthorized() Problem. The real reason is logged here, at
					// warn, so it's still diagnosable from logs — it just never
					// reaches the caller, per research/api-auth.md §9's
					// no-distinguishing-detail discipline.
					request.log.warn({ err }, "auth rejected");
					throw unauthorized();
				}
			}
		);

		server.addHook("preHandler", async (request, reply) => {
			// routeOptions.config is undefined for routes that don't set
			// `config` at all — undefined is treated as "protected", not
			// "public". A route must OPT IN to being public; it can never
			// end up public by omission. This is the fail-closed default.
			if (request.routeOptions.config?.public) return;
			await server.verifyBearerToken(request);
		});
	},
	{ name: "auth" }
);
```

**Why `server.decorate("verifyBearerToken", ...)` still exists, even though the global hook already calls it directly:** route-level tests and any route wanting to layer `requireScope` after it (a follow-up, not part of this refactor — see §7) can still reference `fastify.verifyBearerToken` explicitly rather than relying only on the implicit global hook. Keeping it decorated (not just an inline closure inside the hook) preserves that flexibility at no cost.

### 4.3 Changed: `apps/api/src/app.ts`

`buildServer(...)`'s `pluginAutoLoadParameters.options` needs `authConfig: config.auth` added, so the autoloaded `plugins/auth.ts` receives it — mirroring how `appInfo`/`enableSwagger` already flow into the plugins directory today.

### 4.4 Changed: `apps/api/src/server.ts`

`BuildServerOptions` and the `options` object passed to `pluginAutoLoadParameters` need `authConfig` threaded through, same shape as `appInfo`/`enableSwagger` are today (lines 108-117 in the current file).

### 4.5 Changed: routes that must stay reachable without a token

Enumerated by reading the actual route tree (`find apps/api/src/routes -type f`), not assumed:

| Route file | Path(s) | Needs `config.public: true`? | Why |
|---|---|---|---|
| `apps/api/src/routes/checks.route.ts` | `GET /ready`, `GET /health` | **Yes** | Load balancers / container orchestrators hit these before any credential exists; they must never require a token. |
| `apps/api/src/plugins/swagger.ts` (registers `@fastify/swagger-ui`) | `GET /docs`, `GET /docs/json` | **Decision needed — see below** | `@fastify/swagger-ui` registers its own routes internally; they aren't hand-written route files this repo controls the `config` object on directly. |
| `apps/api/src/server.ts`'s inline `/` → `/docs` redirect | `GET /` | **Yes** | It's a bare redirect to `/docs`; if `/docs` itself ends up gated (see below), this should still be reachable so the redirect fires, but the *destination* it redirects to is what actually decides whether a human sees content or a 401. |

**The `/docs` question is a real, unresolved design fork — this refactor doesn't answer it, it just surfaces it:**

`research/api-auth.md` §10.4 argues an open `/docs` is a real audit finding (reconnaissance-as-a-service) and §4.6 already specifies gating it — but `@fastify/swagger-ui`'s routes are registered by the library itself, not by a route file in this repo's `routes/` tree, so they don't naturally get a `config.public` key attached the way hand-written routes do. Two ways to resolve this, **neither implemented here**:

1. Register the global `preHandler` hook with a **path-based allowlist fallback** in addition to the `config.public` check (e.g. also skip enforcement for any path starting with `/docs`) — simplest, but reintroduces "open by path pattern" as a second, less-visible exception mechanism alongside `config.public`.
2. Gate `/docs` behind its **own scope** (e.g. `docs:read`, per §4.6's suggestion) by wrapping `@fastify/swagger-ui`'s registration in a way that lets this plugin's `preHandler` still apply to it — requires confirming `@fastify/swagger-ui`'s routes actually run through the normal Fastify route/config pipeline (they likely do, since they're registered via `server.register`, meaning they're still descendants of root and still subject to the global hook — needs verification against the installed version before relying on it).

This refactor's global hook, as specced in §4.2, **will already gate `/docs` by default** (since swagger-ui's internal routes won't set `config.public`) — which may be exactly the intended behavior per §4.6/§10.4, or may be a surprise the first time you try to open `/docs` locally and get a 401. Decide before implementing; don't discover it by accident.

---

## 5. Test plan

### 5.1 Core tests — `auth/verifier.test.ts` (unit, no Fastify, no running server)

Sign real tokens with a throwaway RS256 test keypair (never a hardcoded string secret — `research/api-auth.md` §8.1's "test against real JWT verification" discipline applies here too), point `createTokenVerifier`'s `jwksUri` at a local static JWKS served from that keypair's public half or a test double, and call `verifyToken(token)` directly.

| # | Case | Expected |
|---|---|---|
| 1 | Well-formed, correctly-signed, correct `iss`/`aud`/`alg` | Resolves to `{clientId, scope}` matching the token's `sub`/`scope` |
| 2 | Bad signature (signed with a different keypair) | Rejects `TokenVerificationError` with `reason: "signature"` |
| 3 | Expired (`exp` in the past) | Rejects with `reason: "expired"` |
| 4 | Wrong issuer (`iss` ≠ configured) | Rejects with `reason: "issuer"` |
| 5 | Wrong audience (`aud` ≠ configured) | Rejects with `reason: "audience"` |
| 6 | Wrong algorithm (e.g. signed HS256, using the RSA public key as an HMAC secret — the "alg confusion" attack) | Rejects with `reason: "algorithm"` |
| 7 | Missing `sub` or `scope` claim (or either is non-string) | Rejects with `reason: "missing-claims"` |
| 8 | Malformed token (not even valid JWT structure) | Rejects with `reason: "malformed"` |

These are **core tests** — they exercise `verifyToken` directly, assert on `TokenVerificationError.reason`, and never touch Fastify, `fastify.inject()`, or HTTP status codes at all.

### 5.2 Adapter tests — `plugins/auth.test.ts` (integration-ish, via `fastify.inject()`)

Build a minimal server with the `auth` plugin registered and one protected test route, then assert on the **HTTP-level** behavior — this is where "every failure collapses to the same 401" actually gets proven:

| # | Case | Expected |
|---|---|---|
| 9 | No `Authorization` header at all | `401`, `application/problem+json`, `type: "unauthorized"` |
| 10 | Malformed header (`Authorization: banana`, no `Bearer` scheme) | `401`, same Problem shape as #9 — **not a different shape**, proving the "missing header" and "wrong scheme" cases aren't distinguishable from the response |
| 11 | Well-formed but expired token | `401`, same Problem shape as #9/#10 — proving a *verifier-core* rejection (reason: `expired`) still surfaces identically at the HTTP layer, not as a different status or body |
| 12 | Well-formed but wrong-signature token | `401`, same Problem shape |
| 13 | Valid token on a route with `config.public: true` | `200` (or whatever the route returns) **without** a token at all — proves the opt-out actually works |
| 14 | Valid token on a route with no `config` set (protected by default) | Request without a token → `401`; request with a valid token → passes through to the handler, `request.authContext` populated |
| 15 | Route with no `config.public` key and no token supplied | `401` — this is the fail-closed proof: a route that never mentions auth at all is still protected, not accidentally open |

Case 15 is the single most important test in this whole plan — it's the one that actually validates the "default-closed" motivation from §2, as opposed to merely validating that an explicit `preHandler` works when someone remembers to add it.

### 5.3 What this test split deliberately does NOT cover yet

Route-level scope checks (`requireScope("tx:read")` rejecting a correctly-authenticated-but-wrong-scope caller) are **out of scope for this refactor** — `AuthContext.scope` is populated and available, but nothing in this plan enforces it per-route yet. That's the natural next slice once this lands; tracked as an open question below so it isn't silently forgotten.

---

## 6. Open questions

1. **`/docs` gating** (§4.5): does the global hook gating Swagger's routes by default match intent, or does `/docs` need an explicit carve-out? Needs a decision before implementation, not during.
2. **The `iss`/`aud` error-reason substring match** (§4.1): `mapJoseError`'s distinction between `reason: "issuer"` and `reason: "audience"` currently depends on matching text inside jose's own error message. Worth either (a) accepting this as a minor internal-diagnostics-only fragility (it never reaches the HTTP layer, so a jose version bump breaking it would only blur two *log* categories, not cause a security regression), or (b) checking whether jose exposes a more structured way to distinguish these two failure modes before implementing.
3. **`requireScope` / per-route authorization** is explicitly not part of this refactor (§5.3) — when should that land, and does it belong in `auth/verifier.ts` (pure, since scope-string membership needs no Fastify either) or as a second decorator in `plugins/auth.ts`?
4. **Test-keypair provisioning** (§5.1): where does the throwaway RS256 test keypair used to sign test tokens live/get generated — a fixture checked into the test directory, or generated fresh per test run? Either is fine; pick one convention before the first test file is written so every subsequent auth test follows it.
5. **`FastifyContextConfig` augmentation scope**: the `public?: boolean` module augmentation in `plugins/auth.ts` becomes globally visible to every route's `config` object the moment this plugin is loaded — confirm no other part of the codebase already uses `config.public` for an unrelated purpose (grep turned up nothing today, but worth a final check at implementation time since this is a global ambient type change).
