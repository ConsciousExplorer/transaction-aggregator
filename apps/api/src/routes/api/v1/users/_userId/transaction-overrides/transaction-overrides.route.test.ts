// src/routes/api/v1/users/_userId/transaction-overrides/transaction-overrides.route.test.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import transactionOverridesRoute from "./transaction-overrides.route.ts";

const USER_ID = "7a1e5b3c-2d4f-4e6a-8b9c-0d1e2f3a4b5c";
const TX_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const URL = `/api/v1/users/${USER_ID}/transactions/${TX_ID}`;

// Typed off the real methods so drift in the select shapes breaks compilation.
// D34: the detail row carries the effective categoryId; slugs are display-only.
// This route only reads occurredAt/categoryId off the fixture (ownership
// probe) — the rest exists purely to satisfy the real repository return type.
const ORIGINAL: Awaited<
	ReturnType<UserTransactionRepository["getTransactionDetail"]>
> = {
	transactionId: TX_ID,
	accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
	externalId: "ext-card-001",
	occurredAt: "2026-08-15T09:30:00.000Z",
	postedAt: null,
	source: "card",
	direction: "debit",
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
	transactionId: TX_ID,
	occurredAt: "2026-08-15T09:30:00.000Z",
	categoryId: 5,
	createdAt: "2026-09-03T08:00:00.000Z",
	updatedAt: "2026-09-03T08:00:00.000Z",
	archivedAt: null
};

const ARCHIVED: NonNullable<
	Awaited<ReturnType<UserTransactionRepository["archiveTransactionCategory"]>>
> = { ...OVERRIDE, archivedAt: "2026-09-05T08:00:00.000Z" };

// `satisfies` is the drift guard: if the real class gains a member or changes
// a signature, this fake stops compiling. `dbClient` is here only to satisfy
// the class shape — the route never touches it (it goes through the methods).
const getTransactionDetail = mock.fn(async () => ORIGINAL);
const setTransactionCategory = mock.fn(async () => OVERRIDE);
const archiveTransactionCategory = mock.fn(async () => ARCHIVED);
const transactionRepository = {
	dbClient: {} as Pool,
	getTransactions: mock.fn(async () => []),
	getTransactionDetail,
	setTransactionCategory,
	archiveTransactionCategory
} satisfies UserTransactionRepository;

// ── Suite ────────────────────────────────────────────────────────────────────
suite(
	"PUT/DELETE /api/v1/users/:userId/transactions/:transactionId/category",
	() => {
		let app: FastifyInstance;

		before(async () => {
			// buildServer({}) = defaults only, NO autoload — we register the one
			// route under test ourselves, with exactly the opts it declares.
			app = buildServer({});
			await app.register(transactionOverridesRoute, {
				prefix: "/api/v1/users/:userId/transactions",
				transactionRepository
			});
			await app.ready();
		});
		after(async () => {
			await app.close();
		});
		beforeEach(() => {
			getTransactionDetail.mock.resetCalls();
			getTransactionDetail.mock.mockImplementation(async () => ORIGINAL);
			setTransactionCategory.mock.resetCalls();
			setTransactionCategory.mock.mockImplementation(async () => OVERRIDE);
			archiveTransactionCategory.mock.resetCalls();
			archiveTransactionCategory.mock.mockImplementation(async () => ARCHIVED);
		});

		test("PUT 200: upserts by id with the original occurredAt, reports isOverridden", async () => {
			const res = await app.inject({
				method: "PUT",
				url: URL,
				payload: { categoryId: 5 }
			});
			assert.strictEqual(res.statusCode, 200);
			assert.deepStrictEqual(res.json(), {
				transactionId: TX_ID,
				categoryId: 5,
				isOverridden: true, // original effective categoryId was 1
				updatedAt: "2026-09-03T08:00:00.000Z"
			});
			// The immutable occurredAt comes from the ownership read (D34: no resolve).
			assert.deepStrictEqual(
				setTransactionCategory.mock.calls[0]?.arguments.at(0),
				{
					userId: USER_ID,
					transactionId: TX_ID,
					occurredAt: "2026-08-15T09:30:00.000Z",
					categoryId: 5
				}
			);
		});

		test("PUT 200: re-putting the current effective category → isOverridden false", async () => {
			setTransactionCategory.mock.mockImplementationOnce(async () => ({
				...OVERRIDE,
				categoryId: 1
			}));
			const res = await app.inject({
				method: "PUT",
				url: URL,
				payload: { categoryId: 1 }
			});
			assert.strictEqual(res.statusCode, 200);
			assert.strictEqual(res.json().isOverridden, false);
		});

		test("PUT 400: unknown categoryId (FK violation → repo returns undefined)", async () => {
			// The repo maps a 23503 foreign-key violation to undefined (D34).
			setTransactionCategory.mock.mockImplementationOnce(
				async () => undefined as unknown as typeof OVERRIDE
			);
			const res = await app.inject({
				method: "PUT",
				url: URL,
				payload: { categoryId: 999 }
			});
			assert.strictEqual(res.statusCode, 400);
			assert.strictEqual(res.json().type, "validation-error");
		});

		test("PUT 404: transaction not owned/not found → not-found problem, nothing written", async () => {
			// The repo types the `[result]` destructure as Row, but at runtime a
			// missing row yields undefined — exactly what the route's guard handles.
			getTransactionDetail.mock.mockImplementationOnce(
				async () => undefined as unknown as typeof ORIGINAL
			);
			const res = await app.inject({
				method: "PUT",
				url: URL,
				payload: { categoryId: 5 }
			});
			assert.strictEqual(res.statusCode, 404);
			assert.strictEqual(res.json().type, "not-found");
			assert.strictEqual(setTransactionCategory.mock.callCount(), 0);
		});

		test("PUT repository failure → 500 problem+json with zero internals on the wire", async () => {
			setTransactionCategory.mock.mockImplementationOnce(async () => {
				throw new Error("pg password=hunter2");
			});
			const res = await app.inject({
				method: "PUT",
				url: URL,
				payload: { categoryId: 5 }
			});
			assert.strictEqual(res.statusCode, 500);
			assert.ok(
				String(res.headers["content-type"]).startsWith(
					"application/problem+json"
				)
			);
			assert.strictEqual(res.json().type, "internal");
			assert.ok(!res.body.includes("hunter2"));
		});

		test("DELETE 204: archives by transactionId, no ownership probe, no body", async () => {
			const res = await app.inject({ method: "DELETE", url: URL });
			assert.strictEqual(res.statusCode, 204);
			assert.strictEqual(res.body, "");
			assert.deepStrictEqual(
				archiveTransactionCategory.mock.calls[0]?.arguments,
				[USER_ID, TX_ID]
			);
		});

		test("DELETE 204: idempotent — nothing to archive is still success", async () => {
			// Zero-row update: the repo's [result] destructure yields undefined.
			archiveTransactionCategory.mock.mockImplementationOnce(
				async () => undefined as unknown as typeof ARCHIVED
			);
			const res = await app.inject({ method: "DELETE", url: URL });
			assert.strictEqual(res.statusCode, 204);
		});

		test("DELETE repository failure → 500 problem+json with zero internals on the wire", async () => {
			archiveTransactionCategory.mock.mockImplementationOnce(async () => {
				throw new Error("pg password=hunter2");
			});
			const res = await app.inject({ method: "DELETE", url: URL });
			assert.strictEqual(res.statusCode, 500);
			assert.strictEqual(res.json().type, "internal");
			assert.ok(!res.body.includes("hunter2"));
		});
	}
);
