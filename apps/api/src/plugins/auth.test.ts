import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet } from "jose";
import z from "zod";
import {
	buildTestSigningKeys,
	signTestToken,
	TEST_AUDIENCE,
	TEST_ISSUER
} from "#src/auth/test-tokens.ts";
import { buildServer } from "#src/server.ts";
import authPlugin from "./auth.ts";

function buildAuthHeaders(token: string) {
	return { authorization: `Bearer ${token}` };
}

suite("auth hook", () => {
	let app: FastifyInstance;
	let readToken: string;
	let writeToken: string;

	before(async () => {
		// Signed with a key made for this run, and verified for real
		const { privateKey, tokenVerification } = await buildTestSigningKeys();
		readToken = await signTestToken(privateKey, {
			sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
			azp: "banking-service",
			scope: "tx:read"
		});
		writeToken = await signTestToken(privateKey, {
			sub: "7d2e9b40-3c1a-4f5e-a6b7-8c9d0e1f2a3b",
			azp: "banking-portal",
			scope: "tx:read tx:write"
		});

		app = buildServer({});
		await app.register(authPlugin, { tokenVerification });

		app.get(
			"/write-only",
			{ config: { authConfig: { requiredScope: ["tx:write"] } } },
			async () => ({ ok: true })
		);
		app.get(
			"/validated",
			{
				config: { authConfig: { requiredScope: ["tx:read"] } },
				schema: { querystring: z.object({ limit: z.coerce.number().int() }) }
			},
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
		const response = await app.inject({ method: "GET", url: "/write-only" });
		assert.strictEqual(response.statusCode, 401);
		assert.strictEqual(response.json().type, "unauthorized");
	});

	test("401, not 400, without a token on a request that would fail validation", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/validated?limit=many"
		});
		assert.strictEqual(response.statusCode, 401);
		assert.strictEqual(response.json().type, "unauthorized");
	});

	test("401 with a token that does not verify", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: buildAuthHeaders("forged")
		});
		assert.strictEqual(response.statusCode, 401);
	});

	test("403 when the token is valid but lacks the route's scope", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: buildAuthHeaders(readToken)
		});
		assert.strictEqual(response.statusCode, 403);
		assert.strictEqual(response.json().type, "forbidden");
	});

	test("200 when the token carries the route's scope", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: buildAuthHeaders(writeToken)
		});
		assert.strictEqual(response.statusCode, 200);
	});

	test("a public route needs no token", async () => {
		const response = await app.inject({ method: "GET", url: "/open" });
		assert.strictEqual(response.statusCode, 200);
	});
});

suite("auth hook when the signing keys cannot be fetched", () => {
	let app: FastifyInstance;
	let readToken: string;

	before(async () => {
		const { privateKey } = await buildTestSigningKeys();
		readToken = await signTestToken(privateKey, {
			sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
			azp: "banking-service",
			scope: "tx:read"
		});

		app = buildServer({});
		await app.register(authPlugin, {
			tokenVerification: {
				// Nothing listens on port 1: the identity provider is down
				getSigningKey: createRemoteJWKSet(new URL("http://127.0.0.1:1/certs")),
				issuer: TEST_ISSUER,
				audience: TEST_AUDIENCE
			}
		});
		app.get(
			"/guarded",
			{ config: { authConfig: { requiredScope: ["tx:read"] } } },
			async () => ({ ok: true })
		);
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	// The token was never checked, so telling the caller it is bad would send
	// it after new tokens from the same identity provider that is down
	test("503 auth-unavailable, not 401", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/guarded",
			headers: buildAuthHeaders(readToken)
		});
		assert.strictEqual(response.statusCode, 503);
		assert.strictEqual(response.json().type, "auth-unavailable");
	});
});
