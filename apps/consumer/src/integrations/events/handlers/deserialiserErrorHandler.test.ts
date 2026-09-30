import assert from "node:assert";
import { suite, test } from "node:test";
import {
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import { SchemaRegistryError } from "#src/errors/consumer-errors.ts";
import { deserialisationErrorHandler } from "./deserialiserErrorHandler.ts";

function contextWith(error: unknown): DeserializationErrorContext {
	return { error, payloadType: "value" } as DeserializationErrorContext;
}

function registryError(status: number | undefined) {
	return new SchemaRegistryError("registry read failed", { status });
}

suite("deserialisation error policy", () => {
	test("a registry that cannot answer stops the consumer", () => {
		assert.equal(
			deserialisationErrorHandler(contextWith(registryError(503))),
			DeserializationErrorActions.FAIL
		);
		assert.equal(
			deserialisationErrorHandler(contextWith(registryError(undefined))),
			DeserializationErrorActions.FAIL
		);
	});

	test("a schema id the registry does not know is dead-lettered", () => {
		assert.equal(
			deserialisationErrorHandler(contextWith(registryError(404))),
			DeserializationErrorActions.CONTINUE
		);
	});

	test("undecodable bytes are dead-lettered", () => {
		assert.equal(
			deserialisationErrorHandler(contextWith(new Error("truncated body"))),
			DeserializationErrorActions.CONTINUE
		);
	});
});
