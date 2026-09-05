// src/routes/api/v1/users/_userId/category-overrides/category-overrides.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import categoryOverridesRoute from "./category-overrides.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const overrideUrl = (categoryId: number | string) =>
	`/api/v1/users/${USER_ID}/categories/${categoryId}`;

// Typed off the real methods so drift in the select shapes breaks compilation.
// D34: ids are the wire identifiers on writes; the route nests category/label
// display fields around them for both reads and write responses.
const USER_CATEGORY_ROWS: Awaited<
	ReturnType<CategoryRepository["getUserCategories"]>
> = [
	{
		categoryId: 1,
		category: "groceries",
		label: "Groceries",
		toCategoryId: 5,
		toCategory: "dining",
		toLabel: "Dining",
		createdAt: "2026-09-01T08:00:00.000Z",
		updatedAt: "2026-09-03T08:00:00.000Z"
	},
	{
		categoryId: 5,
		category: "dining",
		label: "Dining",
		toCategoryId: null,
		toCategory: null,
		toLabel: null,
		createdAt: null,
		updatedAt: null
	}
];

const OVERRIDE: NonNullable<
	Awaited<ReturnType<CategoryRepository["updateUserCategory"]>>
> = {
	userId: USER_ID,
	fromCategoryId: 1,
	toCategoryId: 5,
	createdAt: "2026-09-01T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: null,
	category: "groceries",
	label: "Groceries",
	toCategory: "dining",
	toLabel: "Dining"
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
suite("PUT/DELETE /api/v1/users/:userId/categories/:categoryId (category overrides)", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(categoryOverridesRoute, {
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

	test("PUT 200: same shape as GET \"\" — id/category/label plus the new mappedTo", async () => {
		const res = await app.inject({
			method: "PUT",
			url: overrideUrl(1),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			id: 1,
			category: "groceries",
			label: "Groceries",
			mappedTo: {
				id: 5,
				category: "dining",
				label: "Dining",
				updatedAt: "2026-09-03T08:00:00.000Z"
			}
		});
		// No slug resolution on the write path — only ids cross into the repo call.
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
