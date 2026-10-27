import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import registerCategoriesRoute from "./categories.route.ts";

const ROWS = [
	{ categoryId: 1, category: "groceries", label: "Groceries" },
	{ categoryId: 2, category: "dining", label: "Dining" }
];

// `satisfies` is the drift guard: the fake must match the real methods the
// route calls, so a change to one of their signatures stops this compiling.
const getCategories = mock.fn<CategoryRepository["getCategories"]>(
	async () => ROWS
);
const categoryRepository = {
	getCategories
} satisfies Pick<CategoryRepository, "getCategories">;

suite("GET /api/v1/categories", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerCategoriesRoute, {
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

	test("200: maps rows to { categoryId, category, label }, ids are public", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/api/v1/categories"
		});
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			data: [
				{ categoryId: 1, category: "groceries", label: "Groceries" },
				{ categoryId: 2, category: "dining", label: "Dining" }
			],
			links: { self: "/api/v1/categories" },
			meta: { count: 2 }
		});
	});

	test("200: an empty table is an empty list", async () => {
		getCategories.mock.mockImplementationOnce(async () => []);
		const response = await app.inject({
			method: "GET",
			url: "/api/v1/categories"
		});
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			data: [],
			links: { self: "/api/v1/categories" },
			meta: { count: 0 }
		});
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		getCategories.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({
			method: "GET",
			url: "/api/v1/categories"
		});
		assert.strictEqual(response.statusCode, 500);
		assert.ok(
			String(response.headers["content-type"]).startsWith(
				"application/problem+json"
			)
		);
		assert.strictEqual(response.json().type, "internal");
		assert.ok(!response.body.includes("hunter2"));
	});

	test("handler calls the repository once, with no arguments", async () => {
		// The pool reaches the repository via the awilix constructor, not per
		// call; that wiring is a container test, invisible from route level.
		await app.inject({ method: "GET", url: "/api/v1/categories" });
		assert.strictEqual(getCategories.mock.callCount(), 1);
		assert.deepStrictEqual(getCategories.mock.calls[0]?.arguments, []);
	});
});
