import assert from "node:assert";
import { suite, test } from "node:test";
import avsc from "avsc";
import { createFetchOnMiss, deserialise } from "./avro-deserialiser.ts";

const SCHEMA = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [{ name: "amount", type: "int" }]
});

/** Confluent wire format: magic byte 0, int32 schema id, Avro body. */
function buildFramedPayload(schemaId: number): Buffer {
	const header = Buffer.alloc(5);
	header.writeUInt8(0, 0);
	header.writeInt32BE(schemaId, 1);
	return Buffer.concat([header, Buffer.from([2])]);
}

function createEmptyCache() {
	return new Map<number, avsc.Type>();
}

function createCountingFetch(respond: () => Promise<string>) {
	const calls: number[] = [];

	async function fetchSchemaText(schemaId: number) {
		calls.push(schemaId);
		return respond();
	}

	return { calls, fetchSchemaText };
}

suite("deserialise", () => {
	const types = new Map([[7, avsc.Type.forSchema(JSON.parse(SCHEMA))]]);

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
});

suite("fetch-on-miss", () => {
	test("a schema id already loaded is not fetched", async () => {
		const cache = createEmptyCache();
		cache.set(7, avsc.Type.forSchema(JSON.parse(SCHEMA)));
		const registry = createCountingFetch(async () => SCHEMA);

		await createFetchOnMiss(cache, registry.fetchSchemaText)(
			buildFramedPayload(7),
			"value"
		);

		assert.deepEqual(registry.calls, []);
	});

	test("an unknown schema id is fetched once and cached", async () => {
		const cache = createEmptyCache();
		const registry = createCountingFetch(async () => SCHEMA);
		const fetchOnMiss = createFetchOnMiss(cache, registry.fetchSchemaText);

		await fetchOnMiss(buildFramedPayload(9), "value");
		await fetchOnMiss(buildFramedPayload(9), "value");

		assert.deepEqual(registry.calls, [9]);
		assert.ok(cache.has(9));
	});

	test("keys, tombstones and unframed payloads are left alone", async () => {
		const registry = createCountingFetch(async () => SCHEMA);
		const fetchOnMiss = createFetchOnMiss(
			createEmptyCache(),
			registry.fetchSchemaText
		);

		await fetchOnMiss(buildFramedPayload(3), "key");
		await fetchOnMiss(null, "value");
		await fetchOnMiss(Buffer.from("not avro"), "value");

		assert.deepEqual(registry.calls, []);
	});

	test("a failed read propagates and caches nothing", async () => {
		const cache = createEmptyCache();
		const failure = new Error("registry down");
		let fail = true;
		const registry = createCountingFetch(async () => {
			if (fail) throw failure;
			return SCHEMA;
		});
		const fetchOnMiss = createFetchOnMiss(cache, registry.fetchSchemaText);

		await assert.rejects(fetchOnMiss(buildFramedPayload(5), "value"), failure);
		assert.equal(cache.has(5), false);

		fail = false;
		await fetchOnMiss(buildFramedPayload(5), "value");

		assert.deepEqual(registry.calls, [5, 5]);
		assert.ok(cache.has(5));
	});
});
