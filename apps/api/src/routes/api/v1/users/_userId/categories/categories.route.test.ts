import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import { buildServer } from "#src/server.ts";
import registerUserCategoriesRoute from "./categories.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const CATEGORIES_URL = `/api/v1/users/${USER_ID}/categories`;

// Typed off the real method so drift in the select shape breaks compilation
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

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `db` is here only to satisfy the
// class shape; the route goes through the methods.
const getUserCategories = mock.fn<CategoryRepository["getUserCategories"]>(
	async () => USER_CATEGORY_ROWS
);
const categoryRepository = {
	db: {} as NodePgDatabase,
	getCategories: mock.fn(async () => []),
	getUserCategories,
	findUnknownCategories: mock.fn(async () => []),
	updateUserCategory: mock.fn(async () => undefined),
	archiveUserCategory: mock.fn(async () => undefined)
} satisfies CategoryRepository;

suite("GET /api/v1/users/:userId/categories", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerUserCategoriesRoute, {
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
	});

	test("200: every category, a remapped one with its mappedTo", async () => {
		const response = await app.inject({ method: "GET", url: CATEGORIES_URL });

		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			data: [
				{
					id: 1,
					category: "groceries",
					label: "Groceries",
					mappedTo: {
						id: 5,
						category: "dining",
						label: "Dining",
						updatedAt: "2026-09-03T08:00:00.000Z"
					}
				},
				{ id: 5, category: "dining", label: "Dining" }
			],
			links: { self: CATEGORIES_URL },
			meta: { count: 2 }
		});
		assert.deepStrictEqual(getUserCategories.mock.calls[0]?.arguments, [
			USER_ID
		]);
	});

	test("400: a userId that isn't a UUID → validation problem, repository untouched", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/api/v1/users/not-a-uuid/categories"
		});

		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(getUserCategories.mock.callCount(), 0);
	});
});
