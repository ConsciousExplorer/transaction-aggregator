import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyInstance } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import registerDeleteTransactionOverrideRoute from "./delete-transaction-override.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const TRANSACTION_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const OVERRIDE_URL = `/api/v1/users/${USER_ID}/transaction-overrides/${TRANSACTION_ID}`;

// Typed off the real method so drift in the select shape breaks compilation
const ARCHIVED: NonNullable<
	Awaited<ReturnType<UserTransactionRepository["archiveTransactionCategory"]>>
> = {
	userId: USER_ID,
	transactionId: TRANSACTION_ID,
	occurredAt: "2026-08-15T09:30:00.000Z",
	categoryId: 5,
	createdAt: "2026-09-03T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: "2026-09-05T08:00:00.000Z"
};

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `db` is here only to satisfy the
// class shape; the route goes through the methods.
const archiveTransactionCategory = mock.fn<
	UserTransactionRepository["archiveTransactionCategory"]
>(async () => ARCHIVED);
const transactionRepository = {
	db: {} as NodePgDatabase,
	getTransactions: mock.fn(async () => []),
	getTransactionDetail: mock.fn(async () => undefined),
	setTransactionCategory: mock.fn(async () => undefined),
	archiveTransactionCategory
} satisfies UserTransactionRepository;

suite("DELETE /api/v1/users/:userId/transaction-overrides/:transactionId", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerDeleteTransactionOverrideRoute, {
			prefix: "/api/v1/users/:userId/transaction-overrides",
			transactionRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		archiveTransactionCategory.mock.resetCalls();
		archiveTransactionCategory.mock.mockImplementation(async () => ARCHIVED);
	});

	test("204: archives by transactionId, no ownership probe, no body", async () => {
		const response = await app.inject({ method: "DELETE", url: OVERRIDE_URL });
		assert.strictEqual(response.statusCode, 204);
		assert.strictEqual(response.body, "");
		assert.deepStrictEqual(
			archiveTransactionCategory.mock.calls[0]?.arguments,
			[USER_ID, TRANSACTION_ID]
		);
	});

	test("204: idempotent, nothing to archive is still success", async () => {
		archiveTransactionCategory.mock.mockImplementationOnce(
			async () => undefined
		);
		const response = await app.inject({ method: "DELETE", url: OVERRIDE_URL });
		assert.strictEqual(response.statusCode, 204);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		archiveTransactionCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({ method: "DELETE", url: OVERRIDE_URL });
		assert.strictEqual(response.statusCode, 500);
		assert.strictEqual(response.json().type, "internal");
		assert.ok(!response.body.includes("hunter2"));
	});
});
