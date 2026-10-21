import assert from "node:assert/strict";
import { after, before, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import authPlugin from "#src/plugins/auth.ts";
import { buildServer } from "#src/server.ts";
import { registry } from "#src/telemetry/metrics.ts";
import registerMetricsRoute from "./metrics.route.ts";

// An empty key set rejects every token, so a 200 proves the route is public
const rejectingTokenVerification = {
	getSigningKey: createLocalJWKSet({ keys: [] }),
	issuer: "unused",
	audience: "unused"
};

suite("GET /metrics", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(authPlugin, {
			tokenVerification: rejectingTokenVerification
		});
		await app.register(registerMetricsRoute);
		await app.ready();
	});
	after(async () => {
		await app.close();
	});

	test("answers without a token, in Prometheus text format, with the HTTP metrics", async () => {
		const response = await app.inject({ method: "GET", url: "/metrics" });

		assert.strictEqual(response.statusCode, 200);
		assert.strictEqual(response.headers["content-type"], registry.contentType);
		assert.match(
			response.body,
			/^# TYPE http_request_duration_seconds histogram$/m
		);
		assert.match(response.body, /^# TYPE http_requests_in_flight gauge$/m);
	});
});
