import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import registerDeleteTransactionOverrideRoute from "./delete-transaction-override.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const TRANSACTION_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const OVERRIDE_URL = `/api/v1/users/${USER_ID}/transaction-overrides/${TRANSACTION_ID}`;

// `satisfies` is the drift guard: the fake must match the real methods the
// route calls, so a change to one of their signatures stops this compiling.
const archiveTransactionCategory = mock.fn<
	UserTransactionRepository["archiveTransactionCategory"]
>(async () => {});
const transactionRepository = {
	archiveTransactionCategory
} satisfies Pick<UserTransactionRepository, "archiveTransactionCategory">;

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
		archiveTransactionCategory.mock.mockImplementation(async () => {});
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
