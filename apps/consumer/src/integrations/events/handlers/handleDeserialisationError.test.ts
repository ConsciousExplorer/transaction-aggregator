import assert from "node:assert";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { suite, test } from "node:test";
import {
	DeserializationErrorActions,
	type DeserializationErrorContext,
	UserError
} from "@platformatic/kafka";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
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
 * The lines the handler logs for an unknown schema id, parsed. It runs in a
 * process of its own because test:unit silences logging, and the logger writes
 * straight to the stdout file descriptor.
 */
function readLogLinesForUnknownSchemaId() {
	const script = `
		const { handleDeserialisationError } = await import("${import.meta.resolve("./handleDeserialisationError.ts")}");
		const { UnknownSchemaIdError } = await import("${import.meta.resolve("#src/errors/consumer-errors.ts")}");
		handleDeserialisationError({
			error: new UnknownSchemaIdError("Unknown schema id 9"),
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
	test("a schema id registered after startup stops the consumer", () => {
		assert.equal(
			handleDeserialisationError(
				buildErrorContext(new UnknownSchemaIdError("Unknown schema id 9"))
			),
			DeserializationErrorActions.FAIL
		);
	});

	test("stopping on an unknown schema id logs where the message is", () => {
		const [logLine] = readLogLinesForUnknownSchemaId();

		assert.equal(logLine?.topic, "transactions.card");
		assert.equal(logLine?.partition, 7);
		assert.equal(logLine?.offset, "10601");
		assert.match(logLine?.err.message, /Unknown schema id 9/);
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
