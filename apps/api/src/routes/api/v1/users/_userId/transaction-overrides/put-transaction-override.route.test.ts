import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import registerPutTransactionOverrideRoute from "./put-transaction-override.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const TRANSACTION_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const OVERRIDE_URL = `/api/v1/users/${USER_ID}/transaction-overrides/${TRANSACTION_ID}`;

// Typed off the real methods so drift in the select shapes breaks compilation.
// The route reads only occurredAt off the transaction (the ownership probe);
// the rest satisfies the repository's return type.
const TRANSACTION: NonNullable<
	Awaited<ReturnType<UserTransactionRepository["getTransactionDetail"]>>
> = {
	transactionId: TRANSACTION_ID,
	accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	externalId: "ext-card-001",
	occurredAt: "2026-08-15T09:30:00.000Z",
	transactionType: "card",
	creditDebitIndicator: "debit",
	status: "completed",
	longDescription: null,
	amountMinor: 1234,
	currency: "ZAR",
	categoryId: 1,
	category: "groceries",
	shortDescription: "Spar",
	metadata: {
		mcc: "5411",
		merchantName: "Spar",
		cardLast4: "1234",
		cardNetwork: "visa",
		posEntryMode: "chip",
		authCode: "A1B2C3"
	}
};

const OVERRIDE: NonNullable<
	Awaited<ReturnType<UserTransactionRepository["setTransactionCategory"]>>
> = {
	userId: USER_ID,
	transactionId: TRANSACTION_ID,
	occurredAt: "2026-08-15T09:30:00.000Z",
	categoryId: 5,
	createdAt: "2026-09-03T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: null
};

// `satisfies` is the drift guard: the fake must match the real methods the
// route calls, so a change to one of their signatures stops this compiling.
const getTransactionDetail = mock.fn<
	UserTransactionRepository["getTransactionDetail"]
>(async () => TRANSACTION);
const setTransactionCategory = mock.fn<
	UserTransactionRepository["setTransactionCategory"]
>(async () => OVERRIDE);
const transactionRepository = {
	getTransactionDetail,
	setTransactionCategory
} satisfies Pick<
	UserTransactionRepository,
	"getTransactionDetail" | "setTransactionCategory"
>;

suite("PUT /api/v1/users/:userId/transaction-overrides/:transactionId", () => {
	let app: FastifyInstance;

	before(async () => {
		app = buildServer({});
		await app.register(registerPutTransactionOverrideRoute, {
			prefix: "/api/v1/users/:userId/transaction-overrides",
			transactionRepository
		});
		await app.ready();
	});
	after(async () => {
		await app.close();
	});
	beforeEach(() => {
		getTransactionDetail.mock.resetCalls();
		getTransactionDetail.mock.mockImplementation(async () => TRANSACTION);
		setTransactionCategory.mock.resetCalls();
		setTransactionCategory.mock.mockImplementation(async () => OVERRIDE);
	});

	test("200: upserts by id with the original occurredAt, returns the saved override", async () => {
		const response = await app.inject({
			method: "PUT",
			url: OVERRIDE_URL,
			payload: { categoryId: 5 }
		});
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			transactionId: TRANSACTION_ID,
			categoryId: 5,
			updatedAt: "2026-09-03T08:00:00.000Z"
		});
		assert.deepStrictEqual(
			setTransactionCategory.mock.calls[0]?.arguments.at(0),
			{
				userId: USER_ID,
				transactionId: TRANSACTION_ID,
				occurredAt: "2026-08-15T09:30:00.000Z",
				categoryId: 5
			}
		);
	});

	test("400: unknown categoryId (FK violation → repository returns undefined)", async () => {
		setTransactionCategory.mock.mockImplementationOnce(async () => undefined);
		const response = await app.inject({
			method: "PUT",
			url: OVERRIDE_URL,
			payload: { categoryId: 999 }
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
	});

	// category_id is a smallint: Postgres refuses a larger id outright, a 500
	test("400: a categoryId beyond the smallint range → validation problem, nothing written", async () => {
		const response = await app.inject({
			method: "PUT",
			url: OVERRIDE_URL,
			payload: { categoryId: 40_000 }
		});
		assert.strictEqual(response.statusCode, 400);
		assert.strictEqual(response.json().type, "validation-error");
		assert.strictEqual(setTransactionCategory.mock.callCount(), 0);
	});

	test("404: transaction not owned or not found → not-found problem, nothing written", async () => {
		getTransactionDetail.mock.mockImplementationOnce(async () => undefined);
		const response = await app.inject({
			method: "PUT",
			url: OVERRIDE_URL,
			payload: { categoryId: 5 }
		});
		assert.strictEqual(response.statusCode, 404);
		assert.strictEqual(response.json().type, "not-found");
		assert.strictEqual(setTransactionCategory.mock.callCount(), 0);
	});

	test("repository failure → 500 problem+json with zero internals on the wire", async () => {
		setTransactionCategory.mock.mockImplementationOnce(async () => {
			throw new Error("pg password=hunter2");
		});
		const response = await app.inject({
			method: "PUT",
			url: OVERRIDE_URL,
			payload: { categoryId: 5 }
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
