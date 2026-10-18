import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import authPlugin from "#src/plugins/auth.ts";
import { buildServer } from "#src/server.ts";
import registerHealthRoute from "./health.route.ts";

// An empty key set rejects every token, so a 200 proves the route is public
const rejectingTokenVerification = {
	getSigningKey: createLocalJWKSet({ keys: [] }),
	issuer: "unused",
	audience: "unused"
};

suite("GET /health", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(authPlugin, {
			tokenVerification: rejectingTokenVerification
		});
		await app.register(registerHealthRoute);
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("answers without a token", async () => {
		const response = await app.inject({ method: "GET", url: "/health" });
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), { status: "ok" });
	});
});
