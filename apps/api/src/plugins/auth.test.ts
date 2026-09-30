import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { TokenVerifier, VerifiedClaims } from "#src/auth/verifier.ts";
import { buildServer } from "#src/server.ts";
import authPlugin from "./auth.ts";

// Real verification is covered in verifier.test.ts; here only the hook's
// decisions matter, so a token string maps straight to its claims.
const TOKENS: Record<string, VerifiedClaims> = {
	"read-token": { sub: "banking-service", scope: "tx:read" },
	"write-token": { sub: "banking-portal", scope: "tx:read tx:write" }
};

const tokenVerifier: TokenVerifier = {
	async verifyToken(token) {
		const claims = TOKENS[token];
		if (!claims) throw new Error("invalid token");
		return claims;
	}
};

function withToken(token: string) {
	return { authorization: `Bearer ${token}` };
}

suite("auth hook", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(authPlugin, { tokenVerifier });

		app.get(
			"/write-only",
			{ config: { authConfig: { requiredScope: ["tx:write"] } } },
			async () => ({ ok: true })
		);
		app.get(
			"/open",
			{ config: { authConfig: { public: true } } },
			async () => ({ ok: true })
		);

		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("401 without a token", async () => {
		const res = await app.inject({ method: "GET", url: "/write-only" });
		assert.strictEqual(res.statusCode, 401);
		assert.strictEqual(res.json().type, "unauthorized");
	});

	test("401 with a token that does not verify", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: withToken("forged")
		});
		assert.strictEqual(res.statusCode, 401);
	});

	test("403 when the token is valid but lacks the route's scope", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: withToken("read-token")
		});
		assert.strictEqual(res.statusCode, 403);
		assert.strictEqual(res.json().type, "forbidden");
	});

	test("200 when the token carries the route's scope", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: withToken("write-token")
		});
		assert.strictEqual(res.statusCode, 200);
	});

	test("a public route needs no token", async () => {
		const res = await app.inject({ method: "GET", url: "/open" });
		assert.strictEqual(res.statusCode, 200);
	});
});
