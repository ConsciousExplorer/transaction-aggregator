import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { TokenVerifier } from "#src/auth/verifier.ts";
import authPlugin from "#src/plugins/auth.ts";
import { buildServer } from "#src/server.ts";
import checksRoute from "./checks.route.ts";

// Every token is rejected, so a 200 proves the route is public
const rejectingVerifier: TokenVerifier = {
	async verifyToken() {
		throw new Error("no tokens in this test");
	}
};

const query = mock.fn(async () => ({ rows: [{ "?column?": 1 }] }));
const database = { query } as unknown as Pool;

suite("health checks", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(authPlugin, { tokenVerifier: rejectingVerifier });
		await app.register(checksRoute, { database });
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		query.mock.resetCalls();
		query.mock.mockImplementation(async () => ({ rows: [{ "?column?": 1 }] }));
	});

	test("/health answers without a token", async () => {
		const res = await app.inject({ method: "GET", url: "/health" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), { status: "ok" });
	});

	test("/ready answers without a token once the database responds", async () => {
		const res = await app.inject({ method: "GET", url: "/ready" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), { status: "ok" });
		assert.strictEqual(query.mock.callCount(), 1);
	});

	test("/ready is 503 when the database cannot be queried", async () => {
		query.mock.mockImplementationOnce(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		const res = await app.inject({ method: "GET", url: "/ready" });
		assert.strictEqual(res.statusCode, 503);
		assert.deepStrictEqual(res.json(), { status: "unavailable" });
	});
});
