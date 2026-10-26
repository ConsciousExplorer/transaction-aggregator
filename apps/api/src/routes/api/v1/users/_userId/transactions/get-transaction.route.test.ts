import assert from "node:assert/strict";
import { after, before, beforeEach, mock, suite, test } from "node:test";
import type { FastifyInstance, RouteOptions } from "fastify";
import type { UserTransactionRepository } from "#src/integrations/database/repositories/transaction-repository.ts";
import { buildServer } from "#src/server.ts";
import registerGetTransactionRoute from "./get-transaction.route.ts";

const TRANSACTION_ID = "3f8e8c1a-6b1d-4f4e-9a2b-1c9d8e7f6a5b";
const USER_ID = "7b1e4c2a-9d3f-4a5b-8c6d-0e1f2a3b4c5d";
const DETAIL_URL = `/api/v1/users/${USER_ID}/transactions/${TRANSACTION_ID}`;

// Typed off the real method so drift in the select shape breaks compilation.
// metadata matches what apps/consumer's card normaliser writes (camelCase
// keys), the shape transactions.mappers.ts's parseFundingSource parses.
const DETAIL: NonNullable<
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

// `satisfies` is the drift guard: the fake must match the real methods the
// route calls, so a change to one of their signatures stops this compiling.
const getTransactionDetail = mock.fn<
	UserTransactionRepository["getTransactionDetail"]
>(async () => DETAIL);
const transactionRepository = {
	getTransactionDetail
} satisfies Pick<UserTransactionRepository, "getTransactionDetail">;

suite("GET /api/v1/users/:userId/transactions/:transactionId", () => {
	let app: FastifyInstance;
	const routes: RouteOptions[] = [];

	before(async () => {
		app = buildServer({});
		app.addHook("onRoute", (route) => {
			routes.push(route);
		});
		await app.register(registerGetTransactionRoute, {
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
		getTransactionDetail.mock.mockImplementation(async () => DETAIL);
	});

	test("200: detail maps the row to the wire shape, source as a typed union", async () => {
		const response = await app.inject({ method: "GET", url: DETAIL_URL });
		assert.strictEqual(response.statusCode, 200);
		assert.deepStrictEqual(response.json(), {
			transactionId: TRANSACTION_ID,
			accountId: "8f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
			externalId: "ext-card-001",
			occurredAt: "2026-08-15T09:30:00.000Z",
			creditDebitIndicator: "debit",
			status: "completed",
			amount: { amountMinor: 1234, currency: "ZAR" },
			longDescription: null,
			shortDescription: "Spar",
			category: "groceries",
			fundingSource: {
				transactionType: "card",
				cardLast4: "1234",
				cardNetwork: "visa",
				mcc: "5411",
				merchantName: "Spar",
				posEntryMode: "chip",
				authCode: "A1B2C3"
			}
		});
		assert.deepStrictEqual(
			getTransactionDetail.mock.calls[0]?.arguments.at(0),
			{ userId: USER_ID, transactionId: TRANSACTION_ID }
		);
	});

	test("loan principal and interest carry the transaction's own currency", async () => {
		getTransactionDetail.mock.mockImplementationOnce(async () => ({
			...DETAIL,
			transactionType: "loan",
			currency: "USD",
			metadata: {
				operation: "repayment",
				loanAccountId: "5b2e1c3d-4a5f-4e6b-8c7d-9e0f1a2b3c4d",
				loanType: "home",
				principalAmount: 90000,
				interestAmount: 10000
			}
		}));

		const response = await app.inject({ method: "GET", url: DETAIL_URL });
		assert.strictEqual(response.statusCode, 200);
		const fundingSource = response.json().fundingSource;
		assert.deepStrictEqual(fundingSource.principal, {
			amountMinor: 90000,
			currency: "USD"
		});
		assert.deepStrictEqual(fundingSource.interest, {
			amountMinor: 10000,
			currency: "USD"
		});
	});

	test("404: unknown transaction → not-found problem", async () => {
		getTransactionDetail.mock.mockImplementationOnce(async () => undefined);
		const response = await app.inject({ method: "GET", url: DETAIL_URL });
		assert.strictEqual(response.statusCode, 404);
		assert.ok(
			String(response.headers["content-type"]).startsWith(
				"application/problem+json"
			)
		);
		assert.strictEqual(response.json().type, "not-found");
	});

	test("the contract documents the 404 it can answer", () => {
		const route = routes.find((candidate) => candidate.method === "GET");
		const documented = Object.keys(route?.schema?.response ?? {});
		assert.ok(documented.includes("404"), `documents ${documented.join(", ")}`);
	});
});
