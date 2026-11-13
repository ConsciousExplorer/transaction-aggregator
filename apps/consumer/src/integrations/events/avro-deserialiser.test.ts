import assert from "node:assert";
import { afterEach, mock, suite, test } from "node:test";
import type {
	BeforeHookPayloadType,
	MessageToConsume
} from "@platformatic/kafka";
import avsc from "avsc";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import {
	createMissingSchemaLoader,
	deserialise,
	type SchemaTypes
} from "./avro-deserialiser.ts";

const REGISTRY = "http://registry.test";

const SCHEMA = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [{ name: "amount", type: "int" }]
});

// The next version of SCHEMA: a producer added a field
const SCHEMA_WITH_ADDED_FIELD = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [
		{ name: "amount", type: "int" },
		{ name: "country", type: "string" }
	]
});

// The hook is handed the message it is asked about, and never reads it
const MESSAGE = {} as MessageToConsume;

/** Confluent wire format: magic byte 0, int32 schema id, Avro body. */
function buildFramedPayload(schemaId: number, body = Buffer.from([2])) {
	const header = Buffer.alloc(5);
	header.writeUInt8(0, 0);
	header.writeInt32BE(schemaId, 1);
	return Buffer.concat([header, body]);
}

/** The schemas a consumer holds after startup: version 1, under id 7. */
function buildLoadedTypes() {
	return new Map([[7, avsc.Type.forSchema(JSON.parse(SCHEMA))]]);
}

/** A registry that answers every request with this status and body. */
function respondWith(status: number, body: unknown) {
	return mock.method(globalThis, "fetch", async () =>
		Response.json(body, { status })
	);
}

// The hook settles through its promise, so it never calls the callback the
// client hands it.
function ignoreCallback() {}

/** Runs the hook for one payload, as the client does before it decodes a fetch. */
async function runLoader(
	types: SchemaTypes,
	payload: Buffer | null,
	payloadType: BeforeHookPayloadType
) {
	const loadMissingSchema = createMissingSchemaLoader(REGISTRY, types);

	await loadMissingSchema(payload, payloadType, MESSAGE, ignoreCallback);
}

suite("deserialise", () => {
	const types = buildLoadedTypes();

	test("a framed record decodes and keeps the bytes it arrived as", () => {
		const data = buildFramedPayload(7);

		const decoded = deserialise<{ amount: number }>(types, data);

		assert.equal(decoded?.value.amount, 1);
		assert.strictEqual(decoded?.raw, data);
	});

	test("an empty payload is a tombstone", () => {
		assert.equal(deserialise(types, Buffer.alloc(0)), undefined);
	});

	test("unframed bytes are rejected", () => {
		assert.throws(
			() => deserialise(types, Buffer.from("not avro")),
			/Not Confluent wire format/
		);
	});

	test("a schema id that was never loaded is its own error", () => {
		assert.throws(
			() => deserialise(types, buildFramedPayload(9)),
			UnknownSchemaIdError
		);
	});
});

suite("missing schema loader", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	test("a schema id that is already loaded asks the registry nothing", async () => {
		const fetchMock = respondWith(200, { schema: SCHEMA });

		await runLoader(buildLoadedTypes(), buildFramedPayload(7), "value");

		assert.equal(fetchMock.mock.callCount(), 0);
	});

	// A producer rolled out a version with an added field while this consumer
	// was running. The record decodes with that version, and the consumer goes
	// on reading the fields it knows.
	test("a schema registered after startup is fetched once, and its records decode", async () => {
		const fetchMock = respondWith(200, { schema: SCHEMA_WITH_ADDED_FIELD });
		const types = buildLoadedTypes();
		// amount 1, then the two-character string "ZA"
		const payload = buildFramedPayload(9, Buffer.from([2, 4, 0x5a, 0x41]));

		await runLoader(types, payload, "value");
		await runLoader(types, payload, "value");

		assert.equal(fetchMock.mock.callCount(), 1);
		assert.equal(
			fetchMock.mock.calls[0]?.arguments[0],
			`${REGISTRY}/schemas/ids/9`
		);
		assert.deepEqual(
			deserialise<{ amount: number; country: string }>(types, payload)?.value,
			{ amount: 1, country: "ZA" }
		);
	});

	test("keys, headers, tombstones and unframed bytes name no schema", async () => {
		const fetchMock = respondWith(200, { schema: SCHEMA });
		const types = buildLoadedTypes();

		await runLoader(types, buildFramedPayload(9), "key");
		await runLoader(types, buildFramedPayload(9), "headerValue");
		await runLoader(types, null, "value");
		await runLoader(types, Buffer.from("not avro"), "value");

		assert.equal(fetchMock.mock.callCount(), 0);
	});

	test("a registry that can't supply the schema fails the message with a registry error", async () => {
		respondWith(404, { error_code: 40403, message: "Schema 9 not found" });
		const types = buildLoadedTypes();

		await assert.rejects(runLoader(types, buildFramedPayload(9), "value"), {
			name: "SchemaRegistryError",
			message: /\[HTTP 404\]/
		});
		assert.equal(types.has(9), false);
	});
});
