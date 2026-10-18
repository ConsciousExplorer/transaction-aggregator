import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import registerDeleteCategoryOverrideRoute from "./delete-category-override.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";

function buildOverrideUrl(categoryId: number) {
	return `/api/v1/users/${USER_ID}/category-overrides/${categoryId}`;
}

// Typed off the real method so drift in the select shape breaks compilation
const ARCHIVED: NonNullable<
	Awaited<ReturnType<CategoryRepository["archiveUserCategory"]>>
> = {
	userId: USER_ID,
	fromCategoryId: 1,
	toCategoryId: 5,
	createdAt: "2026-09-01T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: "2026-09-05T08:00:00.000Z"
};

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `db` is here only to satisfy the
// class shape; the route goes through the methods.
const archiveUserCategory = mock.fn<CategoryRepository["archiveUserCategory"]>(
	async () => ARCHIVED
);
const categoryRepository = {
	db: {} as NodePgDatabase,
	getCategories: mock.fn(async () => []),
	getUserCategories: mock.fn(async () => []),
	resolveCategory: mock.fn(async () => undefined),
	updateUserCategory: mock.fn(async () => undefined),
	archiveUserCategory
} satisfies CategoryRepository;

suite("DELETE /api/v1/users/:userId/category-overrides/:categoryId", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerDeleteCategoryOverrideRoute, {
			prefix: "/api/v1/users/:userId/category-overrides",
			categoryRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		archiveUserCategory.mock.resetCalls();
		archiveUserCategory.mock.mockImplementation(async () => ARCHIVED);
	});

	test("204: archives by id, no body", async () => {
		const response = await app.inject({
			method: "DELETE",
			url: buildOverrideUrl(1)
		});
		assert.strictEqual(response.statusCode, 204);
		assert.strictEqual(response.body, "");
		assert.deepStrictEqual(archiveUserCategory.mock.calls[0]?.arguments, [
			USER_ID,
			1
		]);
	});

	test("204: idempotent, nothing to archive is still success", async () => {
		archiveUserCategory.mock.mockImplementationOnce(async () => undefined);
		const response = await app.inject({
			method: "DELETE",
			url: buildOverrideUrl(999)
		});
		assert.strictEqual(response.statusCode, 204);
	});
});
