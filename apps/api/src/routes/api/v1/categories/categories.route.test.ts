// src/routes/api/v1/categories/categories.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import categoriesRoute from "./categories.route.ts";

// ── This suite's fakes — only what the route touches ─────────────────────────
const ROWS = [
	{ categoryId: 1, category: "groceries", label: "Groceries" },
	{ categoryId: 2, category: "dining", label: "Dining" }
];

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `db` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getCategories = mock.fn(async () => ROWS);
const categoryRepository = {
	db: {} as NodePgDatabase,
	getCategories,
	getUserCategories: mock.fn(async () => []),
	resolveCategory: mock.fn(async () => undefined),
	updateUserCategory: mock.fn(async () => undefined),
	archiveUserCategory: mock.fn(async () => undefined)
} satisfies CategoryRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("GET /api/v1/categories", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(categoriesRoute, {
			prefix: "/api/v1/categories",
			categoryRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		getCategories.mock.resetCalls();
		getCategories.mock.mockImplementation(async () => ROWS);
	});

	test("200: maps rows to { categoryId, category, label } — ids are public", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{ categoryId: 1, category: "groceries", label: "Groceries" },
				{ categoryId: 2, category: "dining", label: "Dining" }
			],
			links: { self: "/api/v1/categories" },
			meta: { count: 2 }
		});
	});

	test("200: empty table → empty data — the notFoundError branch is unreachable", async () => {
		getCategories.mock.mockImplementationOnce(async () => []);
		const res = await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [],
			links: { self: "/api/v1/categories" },
			meta: { count: 0 }
		});
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
		assert.strictEqual(res.json().type, "internal");
		assert.ok(!res.body.includes("hunter2"));
	});

	test("handler calls the repository once, with no arguments", async () => {
		// The pool reaches the repository via the awilix constructor, not per
		// call — that wiring is a container test, invisible from route level.
		await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(getCategories.mock.callCount(), 1);
		assert.deepStrictEqual(getCategories.mock.calls[0]?.arguments, []);
	});
});
