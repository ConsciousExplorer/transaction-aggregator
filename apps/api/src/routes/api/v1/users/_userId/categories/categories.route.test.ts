// src/routes/api/v1/users/_userId/categories/override.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import categoriesRoute from "./categories.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const url = (category: string) =>
	`/api/v1/users/${USER_ID}/categories/${category}/override`;

// The taxonomy this suite's resolveCategory fake knows about.
const TAXONOMY: Record<
	string,
	Awaited<ReturnType<CategoryRepository["resolveCategory"]>>
> = {
	groceries: { categoryId: 1, category: "groceries", label: "Groceries" },
	dining: { categoryId: 5, category: "dining", label: "Dining" }
};

const OVERRIDE: NonNullable<
	Awaited<ReturnType<CategoryRepository["updateUserCategory"]>>
> = {
	userId: USER_ID,
	fromCategoryId: 1,
	toCategoryId: 5,
	createdAt: "2026-09-03T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: null
};

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const resolveCategory = mock.fn(async (category: string) => TAXONOMY[category]);
const updateUserCategory = mock.fn(async () => OVERRIDE);
const archiveUserCategory = mock.fn(async () => OVERRIDE);

// Fixture for the two GETs: groceries carries an active remap, dining none.
const USER_CATEGORY_ROWS: Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
> = [
	{
		category: "groceries",
		label: "Groceries",
		toCategory: "dining",
		updatedAt: "2026-09-03T08:00:00.000Z"
	},
	{ category: "dining", label: "Dining", toCategory: null, updatedAt: null }
];
const getUserCategories = mock.fn(async () => USER_CATEGORY_ROWS);

const categoryRepository = {
	dbClient: {} as Pool,
	getCategories: mock.fn(async () => []),
	getUserCategories,
	resolveCategory,
	updateUserCategory,
	archiveUserCategory
} satisfies CategoryRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("PUT/DELETE /api/v1/users/:userId/categories/:category/override", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(categoriesRoute, {
			prefix: "/api/v1/users/:userId/categories",
			categoryRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		resolveCategory.mock.resetCalls();
		resolveCategory.mock.mockImplementation(
			async (category: string) => TAXONOMY[category]
		);
		updateUserCategory.mock.resetCalls();
		updateUserCategory.mock.mockImplementation(async () => OVERRIDE);
		archiveUserCategory.mock.resetCalls();
		archiveUserCategory.mock.mockImplementation(async () => OVERRIDE);
		getUserCategories.mock.resetCalls();
		getUserCategories.mock.mockImplementation(async () => USER_CATEGORY_ROWS);
	});

	test("GET 200: all categories with the user's remaps applied (toCategory)", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/categories`
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{ category: "groceries", label: "Groceries", toCategory: "dining" },
				{ category: "dining", label: "Dining", toCategory: null }
			]
		});
		assert.deepStrictEqual(getUserCategories.mock.calls[0]?.arguments, [
			USER_ID
		]);
	});

	test("GET /overrides 200: only the overridden categories", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/categories/overrides`
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{
					category: "groceries",
					toCategory: "dining",
					updatedAt: "2026-09-03T08:00:00.000Z"
				}
			]
		});
	});

	test("PUT 200: resolves both slugs and upserts the remap by internal ids", async () => {
		const res = await app.inject({
			method: "PUT",
			url: url("groceries"),
			payload: { toCategory: "dining" }
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			category: "groceries",
			toCategory: "dining",
			updatedAt: "2026-09-03T08:00:00.000Z"
		});
		// D32: the smallint ids cross the repo boundary, never the slugs.
		assert.deepStrictEqual(updateUserCategory.mock.calls[0]?.arguments, [
			USER_ID,
			1,
			5
		]);
	});

	test("PUT 400: unknown source category → validation problem, nothing written", async () => {
		const res = await app.inject({
			method: "PUT",
			url: url("yachts"),
			payload: { toCategory: "dining" }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "urn:api:problem:validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("PUT 400: unknown toCategory → validation problem, nothing written", async () => {
		const res = await app.inject({
			method: "PUT",
			url: url("groceries"),
			payload: { toCategory: "yachts" }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "urn:api:problem:validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("PUT 400: self-remap → validation problem, nothing written", async () => {
		const res = await app.inject({
			method: "PUT",
			url: url("groceries"),
			payload: { toCategory: "groceries" }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "urn:api:problem:validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("DELETE 204: archives by internal id, no body", async () => {
		const res = await app.inject({ method: "DELETE", url: url("groceries") });
		assert.strictEqual(res.statusCode, 204);
		assert.strictEqual(res.body, "");
		assert.deepStrictEqual(archiveUserCategory.mock.calls[0]?.arguments, [
			USER_ID,
			1
		]);
	});

	test("DELETE 204: idempotent — nothing to archive is still success", async () => {
		// Zero-row update: the repo's [result] destructure yields undefined.
		archiveUserCategory.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof OVERRIDE
		);
		const res = await app.inject({ method: "DELETE", url: url("groceries") });
		assert.strictEqual(res.statusCode, 204);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		updateUserCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({
			method: "PUT",
			url: url("groceries"),
			payload: { toCategory: "dining" }
		});
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
