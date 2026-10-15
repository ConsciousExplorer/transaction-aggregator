import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, suite, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { transactions } from "#src/integrations/database/schemas/partitioned.ts";
import {
	categories,
	userCategoryOverrides
} from "#src/integrations/database/schemas/schema.ts";
import {
	connectAs,
	startTestDatabase,
	stopTestDatabase,
	type TestDatabase
} from "./helpers/database.ts";
import {
	INSUFFICIENT_PRIVILEGE,
	readPostgresErrorCode
} from "./helpers/postgres-errors.ts";
import { buildRepositories } from "./helpers/repositories.ts";
import { buildTransactionRow, CATEGORY_IDS } from "./helpers/seed.ts";

// The grants are the API's guarantee that it can't change a transaction fact:
// each test makes the real login try one thing.

function buildAnyTransactionRow(userId: string) {
	return buildTransactionRow({
		userId,
		occurredAt: "2026-08-15T10:00:00.000Z",
		creditDebitIndicator: "debit",
		amountMinor: 1000,
		categoryId: CATEGORY_IDS.groceries
	});
}

function assertPermissionDenied(error: unknown) {
	assert.strictEqual(readPostgresErrorCode(error), INSUFFICIENT_PRIVILEGE);
	return true;
}

suite("database roles", () => {
	let database: TestDatabase;
	let consumerPool: Pool;

	before(
		async () => {
			database = await startTestDatabase();
			consumerPool = connectAs(
				database.container,
				"kafka_consumer",
				"consumer_database_password"
			);
		},
		{ timeout: 180_000 }
	);
	after(async () => {
		await consumerPool.end();
		await stopTestDatabase(database);
	});

	test("api_write cannot insert a transaction", async () => {
		await assert.rejects(async () => {
			await database.apiDb
				.insert(transactions)
				.values(buildAnyTransactionRow(randomUUID()));
		}, assertPermissionDenied);
	});

	test("api_write can upsert a category remap", async () => {
		const { categoryRepository } = buildRepositories(database.apiDb);

		const remap = await categoryRepository.updateUserCategory(
			randomUUID(),
			CATEGORY_IDS.groceries,
			CATEGORY_IDS.dining
		);

		assert.ok(remap);
		assert.strictEqual(remap.toCategoryId, CATEGORY_IDS.dining);
	});

	test("api_write cannot delete an override, only archive it", async () => {
		await assert.rejects(async () => {
			await database.apiDb
				.delete(userCategoryOverrides)
				.where(eq(userCategoryOverrides.userId, randomUUID()));
		}, assertPermissionDenied);
	});

	test("api_write cannot add a category", async () => {
		await assert.rejects(async () => {
			await database.apiDb
				.insert(categories)
				.values({ category: "new", label: "New" });
		}, assertPermissionDenied);
	});

	test("kafka_consumer can insert a transaction but never delete one", async () => {
		const consumerDb = drizzle(consumerPool);
		const userId = randomUUID();

		await consumerDb
			.insert(transactions)
			.values(buildAnyTransactionRow(userId));

		await assert.rejects(async () => {
			await consumerDb
				.delete(transactions)
				.where(eq(transactions.userId, userId));
		}, assertPermissionDenied);
	});

	test("kafka_consumer cannot write a user's preferences", async () => {
		const consumerDb = drizzle(consumerPool);

		await assert.rejects(async () => {
			await consumerDb.insert(userCategoryOverrides).values({
				userId: randomUUID(),
				fromCategoryId: CATEGORY_IDS.groceries,
				toCategoryId: CATEGORY_IDS.dining
			});
		}, assertPermissionDenied);
	});
});
