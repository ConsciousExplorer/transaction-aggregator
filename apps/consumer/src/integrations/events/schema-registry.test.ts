import assert from "node:assert";
import { afterEach, mock, suite, test } from "node:test";
import { getSubjectVersion } from "./schema-registry.ts";

const REGISTRY = "http://registry.test";
const SUBJECT = "transactions.card-value";
const SCHEMA = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [{ name: "amount", type: "int" }]
});

function respondWith(status: number, body: unknown) {
	mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
}

suite("schema registry reads", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	test("a subject version lookup returns its id and schema text", async () => {
		respondWith(200, { subject: SUBJECT, version: 1, id: 7, schema: SCHEMA });

		const { id, schema } = await getSubjectVersion(REGISTRY, SUBJECT, 1);

		assert.equal(id, 7);
		assert.equal(schema, SCHEMA);
	});

	test("a 404 names its status", async () => {
		respondWith(404, { error_code: 40401, message: "Subject not found" });

		await assert.rejects(getSubjectVersion(REGISTRY, SUBJECT, 1), {
			name: "SchemaRegistryError",
			message: /\[HTTP 404\]/
		});
	});

	test("a 5xx names its status", async () => {
		respondWith(503, { message: "unavailable" });

		await assert.rejects(getSubjectVersion(REGISTRY, SUBJECT, 1), {
			name: "SchemaRegistryError",
			message: /\[HTTP 503\]/
		});
	});

	test("an unreachable registry says so", async () => {
		mock.method(globalThis, "fetch", async () => {
			throw new TypeError("fetch failed");
		});

		await assert.rejects(getSubjectVersion(REGISTRY, SUBJECT, 1), {
			name: "SchemaRegistryError",
			message: /unreachable/
		});
	});

	test("a body that is not a schema is a registry error, not a crash elsewhere", async () => {
		respondWith(200, { unexpected: true });

		await assert.rejects(getSubjectVersion(REGISTRY, SUBJECT, 1), {
			name: "SchemaRegistryError",
			message: /unexpected body/
		});
	});
});
