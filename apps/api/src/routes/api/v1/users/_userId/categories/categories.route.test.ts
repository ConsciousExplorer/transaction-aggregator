// src/routes/api/v1/users/_userId/categories/categories.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import categoriesRoute from "./categories.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const overrideUrl = (categoryId: number | string) =>
	`/api/v1/users/${USER_ID}/categories/${categoryId}/override`;

// Typed off the real methods so drift in the select shapes breaks compilation.
// D34: ids are the wire identifiers; slugs/labels are display fields.
const USER_CATEGORY_ROWS: Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
> = [
	{
		categoryId: 1,
		category: "groceries",
		label: "Groceries",
		toCategoryId: 5,
		updatedAt: "2026-09-03T08:00:00.000Z"
	},
	{
		categoryId: 5,
		category: "dining",
		label: "Dining",
		toCategoryId: null,
		updatedAt: null
	}
];

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
const getUserCategories = mock.fn(async () => USER_CATEGORY_ROWS);
const updateUserCategory = mock.fn(async () => OVERRIDE);
const archiveUserCategory = mock.fn(async () => OVERRIDE);
const categoryRepository = {
	dbClient: {} as Pool,
	getCategories: mock.fn(async () => []),
	getUserCategories,
	resolveCategory: mock.fn(async () => undefined),
	updateUserCategory,
	archiveUserCategory
} satisfies CategoryRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("/api/v1/users/:userId/categories (user categories + overrides)", () => {
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
		getUserCategories.mock.resetCalls();
		getUserCategories.mock.mockImplementation(async () => USER_CATEGORY_ROWS);
		updateUserCategory.mock.resetCalls();
		updateUserCategory.mock.mockImplementation(async () => OVERRIDE);
		archiveUserCategory.mock.resetCalls();
		archiveUserCategory.mock.mockImplementation(async () => OVERRIDE);
	});

	test("GET 200: all categories with ids and the user's remap targets", async () => {
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/users/${USER_ID}/categories`
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			data: [
				{
					categoryId: 1,
					category: "groceries",
					label: "Groceries",
					toCategoryId: 5
				},
				{ categoryId: 5, category: "dining", label: "Dining", toCategoryId: null }
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
					categoryId: 1,
					toCategoryId: 5,
					updatedAt: "2026-09-03T08:00:00.000Z"
				}
			]
		});
	});

	test("PUT 200: upserts the remap by ids — no slug resolution", async () => {
		const res = await app.inject({
			method: "PUT",
			url: overrideUrl(1),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			categoryId: 1,
			toCategoryId: 5,
			updatedAt: "2026-09-03T08:00:00.000Z"
		});
		assert.deepStrictEqual(updateUserCategory.mock.calls[0]?.arguments, [
			USER_ID,
			1,
			5
		]);
	});

	test("PUT 400: unknown id (FK violation → repo returns undefined), nothing usable written", async () => {
		// The repo maps a 23503 foreign-key violation to undefined (D34).
		updateUserCategory.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof OVERRIDE
		);
		const res = await app.inject({
			method: "PUT",
			url: overrideUrl(999),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
	});

	test("PUT 400: self-remap → validation problem, nothing written", async () => {
		const res = await app.inject({
			method: "PUT",
			url: overrideUrl(1),
			payload: { toCategoryId: 1 }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.strictEqual(res.json().type, "validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("DELETE 204: archives by id, no body", async () => {
		const res = await app.inject({ method: "DELETE", url: overrideUrl(1) });
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
		const res = await app.inject({ method: "DELETE", url: overrideUrl(999) });
		assert.strictEqual(res.statusCode, 204);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		updateUserCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({
			method: "PUT",
			url: overrideUrl(1),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
