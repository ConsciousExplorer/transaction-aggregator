import assert from "node:assert";
import { suite, test } from "node:test";
import {
	DeserializationErrorActions,
	type DeserializationErrorContext,
	UserError
} from "@platformatic/kafka";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import { handleDeserialisationError } from "./handleDeserialisationError.ts";

function buildErrorContext(error: unknown) {
	return { error, payloadType: "value" } as DeserializationErrorContext;
}

suite("deserialisation error policy", () => {
	test("a schema id registered after startup stops the consumer", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(new UnknownSchemaIdError("Unknown schema id 9"))
			),
			DeserializationErrorActions.FAIL
		);
	});

	test("unframed bytes are dead-lettered", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(new UserError("Not Confluent wire format (8 bytes)"))
			),
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
