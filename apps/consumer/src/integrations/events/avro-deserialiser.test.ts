import assert from "node:assert";
import { suite, test } from "node:test";
import avsc from "avsc";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import { deserialise } from "./avro-deserialiser.ts";

const SCHEMA = JSON.stringify({
	type: "record",
	name: "Txn",
	fields: [{ name: "amount", type: "int" }]
});

/** Confluent wire format: magic byte 0, int32 schema id, Avro body. */
function buildFramedPayload(schemaId: number) {
	const header = Buffer.alloc(5);
	header.writeUInt8(0, 0);
	header.writeInt32BE(schemaId, 1);
	return Buffer.concat([header, Buffer.from([2])]);
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

	test("a schema id not loaded at startup is its own error", () => {
		assert.throws(
			() => deserialise(types, buildFramedPayload(9)),
			UnknownSchemaIdError
		);
	});
});
