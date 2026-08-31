// src/routes/api/v1/categories/categories.route.test.ts
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { pino } from "pino";
import { type AppInfoConfig, loadConfig } from "#src/config.ts";
import { buildServer, type Repositories } from "#src/server.ts"; // static import — DI needs no loader tricks

// ── Fakes ────────────────────────────────────────────────────────────────────
// The pool: throws on ANY property read. With the repo faked, nothing may touch
// pg — if something does, the failure names the offender instead of hanging.
const unreachable = <T>(name: string): T =>
	new Proxy(
		{},
		{
			get(_t, prop) {
				throw new Error(`${name}.${String(prop)} touched in a route unit test`);
			}
		}
	) as T;

const database = unreachable<Pool>("database");

// Fixture WITH the internal id — test 1 proves it never reaches the wire.
const ROWS = [
	{ categoryId: 1, category: "groceries", label: "Groceries" },
	{ categoryId: 2, category: "dining", label: "Dining" }
];

// mock.fn is plain node:test — no module mocking, no experimental flag.
// `satisfies Repositories["categories"]` is the drift guard: if the real module
// gains a function or changes a signature, this fake stops compiling.
const getCategories = mock.fn(async () => ROWS);
const categories = {
	getCategories,
	resolveCategory: mock.fn(async () => undefined)
} satisfies Repositories["categories"];

const appInfo: AppInfoConfig = {
	name: "route-test",
	version: "0.0.0",
	description: "route unit test",
	author: "test"
};

function buildTestApp(): FastifyInstance {
	return buildServer({
		serverOptions: {},
		dependencies: {
			appInfo,
			config: loadConfig({}),
			logger: pino({ level: "silent" }),
			database,
			repositories: { categories },
			autoLoadParameters: {
				dir: resolve(import.meta.dirname, "../../.."), // this file sits IN routes/api/v1/categories → up to src/routes
				dirNameRoutePrefix: true,
				routeParams: true,
				matchFilter: /route\.(ts|js)$/
			}
		}
	});
}

// ── Suite ────────────────────────────────────────────────────────────────────
suite("GET /api/v1/categories", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildTestApp();
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		getCategories.mock.resetCalls();
		getCategories.mock.mockImplementation(async () => ROWS);
	});

	test("200: maps rows to { category, label } and categoryId never reaches the wire", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{ category: "groceries", label: "Groceries" },
				{ category: "dining", label: "Dining" }
			]
		});
		assert.ok(!res.body.includes("categoryId"));
	});

	test("200: empty table → { data: [] } — the notFound branch is unreachable", async () => {
		getCategories.mock.mockImplementationOnce(async () => []);
		const res = await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), { data: [] });
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getCategories.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:internal");
		assert.ok(!res.body.includes("hunter2"));
	});

	test("the injected pool is the exact object handed to the repository", async () => {
		await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(getCategories.mock.callCount(), 1);
		assert.strictEqual(getCategories.mock.calls[0]?.arguments[0], database);
	});
});
