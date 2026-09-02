// src/routes/api/v1/users/_userId/transactions/categories.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { CategoryRepository } from "#src/integrations/database/repositories/category-repository.ts";
import type { TransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import categoriesRoute from "./categories.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const TX_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const URL = `/api/v1/users/${USER_ID}/transactions/${TX_ID}/category`;

// Typed off the real methods so drift in the select shapes breaks compilation.
const DINING: Awaited<ReturnType<CategoryRepository["resolveCategory"]>> = {
	categoryId: 5,
	category: "dining",
	label: "Dining"
};

const ORIGINAL: Awaited<
	ReturnType<TransactionRepository["getUserTransactionDetail"]>
> = {
	transactionId: TX_ID,
	occurredAt: "2026-08-15T09:30:00.000Z",
	source: "card",
	direction: "debit",
	amountMinor: 1234,
	currency: "ZAR",
	category: "groceries",
	merchantName: "Spar"
};

const OVERRIDE: Awaited<
	ReturnType<TransactionRepository["upsertUserTransactionCategory"]>
> = {
	userId: USER_ID,
	transactionId: TX_ID,
	occurredAt: "2026-08-15T09:30:00.000Z",
	categoryId: 5,
	createdAt: "2026-09-02T08:00:00.000Z",
	updatedAt: "2026-09-02T08:00:00.000Z"
};

// `satisfies` is the drift guard: if a real class gains a member or changes
// a signature, these fakes stop compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const resolveCategory = mock.fn(async () => DINING);
const categoryRepository = {
	dbClient: {} as Pool,
	getCategories: mock.fn(async () => []),
	resolveCategory
} satisfies CategoryRepository;

const getUserTransactionDetail = mock.fn(async () => ORIGINAL);
const upsertUserTransactionCategory = mock.fn(async () => OVERRIDE);
const transactionRepository = {
	dbClient: {} as Pool,
	getUserTransactions: mock.fn(async () => []),
	getUserTransactionDetail,
	upsertUserTransactionCategory
} satisfies TransactionRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite("PUT /api/v1/users/:userId/transactions/:transactionId/category", () => {
	let app: FastifyInstance;

	before(async () => {
		// buildServer({}) = defaults only, NO autoload — we register the one
		// route under test ourselves, with exactly the opts it declares.
		app = buildServer({});
		await app.register(categoriesRoute, {
			prefix: "/api/v1/users/:userId/transactions",
			categoryRepository,
			transactionRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		resolveCategory.mock.resetCalls();
		resolveCategory.mock.mockImplementation(async () => DINING);
		getUserTransactionDetail.mock.resetCalls();
		getUserTransactionDetail.mock.mockImplementation(async () => ORIGINAL);
		upsertUserTransactionCategory.mock.resetCalls();
		upsertUserTransactionCategory.mock.mockImplementation(async () => OVERRIDE);
	});

	test("200: resolves the slug, upserts with the original occurredAt, reports isOverridden", async () => {
		const res = await app.inject({
			method: "PUT",
			url: URL,
			payload: { category: "dining" }
		});
		assert.strictEqual(res.statusCode, 200);
		assert.deepStrictEqual(res.json(), {
			transactionId: TX_ID,
			category: "dining",
			isOverridden: true, // original effective category was "groceries"
			updatedAt: "2026-09-02T08:00:00.000Z"
		});
		// The smallint id and the immutable occurredAt come from the two reads.
		assert.deepStrictEqual(
			upsertUserTransactionCategory.mock.calls[0]?.arguments.at(0),
			{
				userId: USER_ID,
				transactionId: TX_ID,
				occurredAt: "2026-08-15T09:30:00.000Z",
				categoryId: 5
			}
		);
	});

	test("200: re-putting the current effective category → isOverridden false", async () => {
		resolveCategory.mock.mockImplementationOnce(async () => ({
			categoryId: 1,
			category: "groceries",
			label: "Groceries"
		}));
		const res = await app.inject({
			method: "PUT",
			url: URL,
			payload: { category: "groceries" }
		});
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(res.json().isOverridden, false);
	});

	test("400: unknown category slug → validation problem, nothing written", async () => {
		// The repo types the `[result]` destructure as Row, but at runtime an
		// unknown slug yields undefined — exactly what the route's guard handles.
		resolveCategory.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof DINING
		);
		const res = await app.inject({
			method: "PUT",
			url: URL,
			payload: { category: "yacht-maintenance" }
		});
		assert.strictEqual(res.statusCode, 400);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:validation-error");
		assert.strictEqual(upsertUserTransactionCategory.mock.callCount(), 0);
	});

	test("404: transaction not owned/not found → not-found problem, nothing written", async () => {
		// Same runtime-undefined story as resolveCategory above.
		getUserTransactionDetail.mock.mockImplementationOnce(
			async () => undefined as unknown as typeof ORIGINAL
		);
		const res = await app.inject({
			method: "PUT",
			url: URL,
			payload: { category: "dining" }
		});
		assert.strictEqual(res.statusCode, 404);
		assert.strictEqual(res.json().type, "urn:api:problem:not-found");
		assert.strictEqual(upsertUserTransactionCategory.mock.callCount(), 0);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		upsertUserTransactionCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const res = await app.inject({
			method: "PUT",
			url: URL,
			payload: { category: "dining" }
		});
		assert.strictEqual(res.statusCode, 500);
		assert.ok(
			String(res.headers["content-type"]).startsWith("application/problem+json")
		);
		assert.strictEqual(res.json().type, "urn:api:problem:internal");
		assert.ok(!res.body.includes("hunter2"));
	});
});
