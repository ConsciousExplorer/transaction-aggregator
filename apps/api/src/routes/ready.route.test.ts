import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import type { Pool } from "pg";
import authPlugin from "#src/plugins/auth.ts";
import { buildServer } from "#src/server.ts";
import registerReadyRoute from "./ready.route.ts";

// An empty key set rejects every token, so a 200 proves the route is public
const rejectingTokenVerification = {
	getSigningKey: createLocalJWKSet({ keys: [] }),
	issuer: "unused",
	audience: "unused"
};

const query = mock.fn(async () => ({ rows: [{ "?column?": 1 }] }));
const pool = { query } as unknown as Pool;

suite("GET /ready", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(authPlugin, {
			tokenVerification: rejectingTokenVerification
		});
		await app.register(registerReadyRoute, { pool });
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		query.mock.resetCalls();
		query.mock.mockImplementation(async () => ({ rows: [{ "?column?": 1 }] }));
	});

	test("answers without a token once the database responds", async () => {
		const response = await app.inject({ method: "GET", url: "/ready" });
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), { status: "ok" });
		assert.strictEqual(query.mock.callCount(), 1);
	});

	test("503 when the database cannot be queried", async () => {
		query.mock.mockImplementationOnce(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		const response = await app.inject({ method: "GET", url: "/ready" });
		assert.strictEqual(response.statusCode, 503);
		assert.deepStrictEqual(response.json(), { status: "unavailable" });
	});
});
