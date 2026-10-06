import assert from "node:assert";
import { suite, test } from "node:test";
import {
	DeserializationErrorActions,
	type DeserializationErrorContext
} from "@platformatic/kafka";
import { SchemaRegistryError } from "#src/errors/consumer-errors.ts";
import { handleDeserialisationError } from "./handleDeserialisationError.ts";

function buildErrorContext(error: unknown): DeserializationErrorContext {
	return { error, payloadType: "value" } as DeserializationErrorContext;
}

function buildRegistryError(status: number | undefined) {
	return new SchemaRegistryError("registry read failed", { status });
}

suite("deserialisation error policy", () => {
	test("a registry that cannot answer stops the consumer", () => {
		assert.equal(
			handleDeserialisationError(buildErrorContext(buildRegistryError(503))),
			DeserializationErrorActions.FAIL
		);
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(buildRegistryError(undefined))
			),
			DeserializationErrorActions.FAIL
		);
	});

	test("a schema id the registry does not know is dead-lettered", () => {
		assert.equal(
			handleDeserialisationError(buildErrorContext(buildRegistryError(404))),
			DeserializationErrorActions.CONTINUE
		);
	});

	test("undecodable bytes are dead-lettered", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(new Error("truncated body"))
			),
			DeserializationErrorActions.CONTINUE
		);
	});
});
