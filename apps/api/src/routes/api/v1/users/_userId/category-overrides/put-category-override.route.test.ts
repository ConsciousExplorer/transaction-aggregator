import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import registerPutCategoryOverrideRoute from "./put-category-override.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";

function buildOverrideUrl(categoryId: number) {
	return `/api/v1/users/${USER_ID}/category-overrides/${categoryId}`;
}

// Typed off the real method so drift in the select shape breaks compilation
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
// a signature, this fake stops compiling. `db` is here only to satisfy the
// class shape; the route goes through the methods.
const updateUserCategory = mock.fn<CategoryRepository["updateUserCategory"]>(
	async () => OVERRIDE
);
const categoryRepository = {
	db: {} as NodePgDatabase,
	getCategories: mock.fn(async () => []),
	getUserCategories: mock.fn(async () => []),
	findUnknownCategories: mock.fn(async () => []),
	updateUserCategory,
	archiveUserCategory: mock.fn(async () => undefined)
} satisfies CategoryRepository;

suite("PUT /api/v1/users/:userId/category-overrides/:categoryId", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerPutCategoryOverrideRoute, {
			prefix: "/api/v1/users/:userId/category-overrides",
			categoryRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		updateUserCategory.mock.resetCalls();
		updateUserCategory.mock.mockImplementation(async () => OVERRIDE);
	});

	test('200: same shape as GET "", id/category/label plus the new mappedTo', async () => {
		const response = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(1),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
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
		// No slug resolution on the write path: only ids reach the repository
		assert.deepStrictEqual(updateUserCategory.mock.calls[0]?.arguments, [
			USER_ID,
			1,
			5
		]);
	});

	test("400: unknown id (FK violation → repository returns undefined)", async () => {
		updateUserCategory.mock.mockImplementationOnce(async () => undefined);
		const response = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(999),
			payload: { toCategoryId: 5 }
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
	});

	// category_id is a smallint: Postgres refuses a larger id outright, a 500
	test("400: an id beyond the smallint range, in the path or the body → validation problem, nothing written", async () => {
		const pathResponse = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(40_000),
			payload: { toCategoryId: 5 }
		});
		const bodyResponse = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(1),
			payload: { toCategoryId: 40_000 }
		});

		assert.strictEqual(pathResponse.statusCode, 400);
		assert.strictEqual(pathResponse.json().type, "validation-error");
		assert.strictEqual(bodyResponse.statusCode, 400);
		assert.strictEqual(bodyResponse.json().type, "validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("400: self-remap → validation problem, nothing written", async () => {
		const response = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(1),
			payload: { toCategoryId: 1 }
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(updateUserCategory.mock.callCount(), 0);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		updateUserCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({
			method: "PUT",
			url: buildOverrideUrl(1),
			payload: { toCategoryId: 5 }
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
});
