import assert from "node:assert/strict";
import { after, before, beforeEach, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import z from "zod";
import type { TokenVerifier, VerifiedClaims } from "#src/auth/verifier.ts";
import { buildServer } from "#src/server.ts";
import auditPlugin from "./audit.ts";
import authPlugin from "./auth.ts";

const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";

// A token string maps straight to its claims, as in auth.test.ts
const TOKENS: Record<string, VerifiedClaims> = {
	"read-token": {
		sub: "4fc8a801-206d-48ec-b511-d1f97e2f057b",
		azp: "banking-service",
		scope: "tx:read"
	}
};

const tokenVerifier: TokenVerifier = {
	async verifyToken(token) {
		const claims = TOKENS[token];
		if (!claims) throw new Error("invalid token");
		return claims;
	}
};

const READ_TOKEN = { authorization: "Bearer read-token" };

// Every line the server logs, parsed
const logLines: Record<string, unknown>[] = [];
const captureStream = {
	write(line: string) {
		logLines.push(JSON.parse(line));
	}
};

/** The audit lines logged so far. onResponse runs once the response is sent. */
async function auditLines() {
	await new Promise((resolve) => setImmediate(resolve));
	return logLines.filter((line) => line.event === "audit");
}

suite("audit line", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({ logger: pino({ level: "info" }, captureStream) });
		await app.register(authPlugin, { tokenVerifier });
		await app.register(auditPlugin);

		app.get(
			"/users/:userId/things",
			{
				config: { authConfig: { requiredScope: ["tx:read"] } },
				schema: { querystring: z.object({ limit: z.coerce.number().int() }) }
			},
			async () => ({ ok: true })
		);
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
	beforeEach(() => {
		logLines.length = 0;
	});

	test("an authenticated request logs one line naming the calling app", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/users/${USER_ID}/things?limit=5`,
			headers: READ_TOKEN
		});
		assert.strictEqual(res.statusCode, 200);

		const lines = await auditLines();
		assert.strictEqual(lines.length, 1);
		const line = lines[0];
		assert.strictEqual(line?.client_id, "banking-service");
		assert.strictEqual(line?.user_id, USER_ID);
		assert.strictEqual(line?.method, "GET");
		assert.strictEqual(line?.route, "/users/:userId/things");
		assert.strictEqual(line?.status, 200);
		assert.strictEqual(typeof line?.trace_id, "string");
	});

	test("a known caller refused by scope is audited with its 403", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/write-only",
			headers: READ_TOKEN
		});
		assert.strictEqual(res.statusCode, 403);

		const lines = await auditLines();
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0]?.status, 403);
		assert.strictEqual(lines[0]?.user_id, null);
	});

	test("a known caller's invalid request is audited with its 400", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/users/${USER_ID}/things?limit=many`,
			headers: READ_TOKEN
		});
		assert.strictEqual(res.statusCode, 400);

		const lines = await auditLines();
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0]?.status, 400);
	});

	test("a request without a valid token gets 401 and no audit line", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/users/${USER_ID}/things?limit=many`
		});
		// 401, not the 400 its query would earn: auth runs before validation
		assert.strictEqual(res.statusCode, 401);
		assert.strictEqual((await auditLines()).length, 0);
	});

	test("a public route is not audited", async () => {
		const res = await app.inject({ method: "GET", url: "/open" });
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual((await auditLines()).length, 0);
	});

	test("no built-in request lines: the audit line is the only one", async () => {
		await app.inject({
			method: "GET",
			url: `/users/${USER_ID}/things?limit=5`,
			headers: READ_TOKEN
		});
		await auditLines();
		assert.deepStrictEqual(
			logLines.map((line) => line.msg),
			["audit"]
		);
	});
});
