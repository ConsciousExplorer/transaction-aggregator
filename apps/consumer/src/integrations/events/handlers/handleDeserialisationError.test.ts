import assert from "node:assert";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { suite, test } from "node:test";
import {
	DeserializationErrorActions,
	type DeserializationErrorContext,
	UserError
} from "@platformatic/kafka";
import {
	SchemaRegistryError,
	UnknownSchemaIdError
} from "#src/errors/consumer-errors.ts";
import { handleDeserialisationError } from "./handleDeserialisationError.ts";

function buildErrorContext(error: unknown) {
	return {
		error,
		payloadType: "value",
		topic: "transactions.card",
		partition: 7,
		offset: 10601n,
		timestamp: 1700000000000n
	} as DeserializationErrorContext;
}

/**
 * The lines the handler logs for a schema the registry couldn't supply,
 * parsed. It runs in a process of its own because test:unit silences logging,
 * and the logger writes straight to the stdout file descriptor.
 */
function readLogLinesForMissingSchema() {
	const script = `
		const { handleDeserialisationError } = await import("${import.meta.resolve("./handleDeserialisationError.ts")}");
		const { SchemaRegistryError } = await import("${import.meta.resolve("#src/errors/consumer-errors.ts")}");
		handleDeserialisationError({
			error: new SchemaRegistryError("Schema registry request failed: [HTTP 404] /schemas/ids/9", { cause: undefined }),
			payloadType: "value",
			topic: "transactions.card",
			partition: 7,
			offset: 10601n
		});
	`;
	const output = execFileSync(
		process.execPath,
		["--input-type=module", "--eval", script],
		{ env: { ...process.env, LOG_LEVEL: "info" }, encoding: "utf8" }
	);

	const lines = [];
	for (const line of output.split("\n")) {
		if (line !== "") lines.push(JSON.parse(line));
	}
	return lines;
}

suite("deserialisation error policy", () => {
	// The registry was down, or doesn't have the id. The message may be fine,
	// so it is read again after the restart instead of being dead-lettered.
	test("a schema the registry couldn't supply stops the consumer", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(
					new SchemaRegistryError("Schema registry unreachable", {
						cause: undefined
					})
				)
			),
			DeserializationErrorActions.FAIL
		);
	});

	test("a schema id that was never loaded stops the consumer", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(new UnknownSchemaIdError("Unknown schema id 9"))
			),
			DeserializationErrorActions.FAIL
		);
	});

	test("stopping on a missing schema logs where the message is", () => {
		const [logLine] = readLogLinesForMissingSchema();

		assert.equal(logLine?.topic, "transactions.card");
		assert.equal(logLine?.partition, 7);
		assert.equal(logLine?.offset, "10601");
		assert.match(logLine?.err.message, /\/schemas\/ids\/9/);
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
