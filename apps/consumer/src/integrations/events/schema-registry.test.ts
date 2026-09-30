import assert from "node:assert";
import { afterEach, mock, suite, test } from "node:test";
import { SchemaRegistryError } from "#src/errors/consumer-errors.ts";
import { getSchemaById } from "./schema-registry.ts";

const REGISTRY = "http://registry.test";
const SCHEMA = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [{ name: "amount", type: "int" }]
});

function respondWith(status: number, body: unknown) {
	mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
}

async function registryErrorFrom(read: Promise<unknown>) {
	try {
		await read;
	} catch (error) {
		assert.ok(error instanceof SchemaRegistryError, String(error));
		return error;
	}
	assert.fail("expected the registry read to fail");
}

suite("schema registry reads", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	test("a schema id lookup returns the schema text", async () => {
		respondWith(200, { schema: SCHEMA });

		const { schema } = await getSchemaById(REGISTRY, 1);

		assert.equal(schema, SCHEMA);
	});

	test("404 carries its status, so the caller can dead-letter", async () => {
		respondWith(404, { error_code: 40403, message: "Schema not found" });

		const error = await registryErrorFrom(getSchemaById(REGISTRY, 1));

		assert.equal(error.status, 404);
	});

	test("5xx carries its status", async () => {
		respondWith(503, { message: "unavailable" });

		const error = await registryErrorFrom(getSchemaById(REGISTRY, 1));

		assert.equal(error.status, 503);
	});

	test("an unreachable registry has no status", async () => {
		mock.method(globalThis, "fetch", async () => {
			throw new TypeError("fetch failed");
		});

		const error = await registryErrorFrom(getSchemaById(REGISTRY, 1));

		assert.equal(error.status, undefined);
	});

	test("a body that is not a schema is a registry error, not a crash elsewhere", async () => {
		respondWith(200, { unexpected: true });

		const error = await registryErrorFrom(getSchemaById(REGISTRY, 1));

		assert.equal(error.status, 200);
	});
});
