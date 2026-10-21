import assert from "node:assert";
import { Readable } from "node:stream";
import { type Mock, mock, suite, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type {
	BatchHandler,
	ClassifiedMessage,
	DeadLetterFailure
} from "./handlers/transactionBatchHandler.ts";
import {
	type BatchConsumerOptions,
	classifyMessages,
	createDeadLetterSender,
	type DeadLetterProducer,
	type KafkaConsumer,
	type KafkaMessage,
	startBatchConsumer
} from "./kafka.ts";

function buildMessage(offset: number) {
	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: `k${offset}`,
		value: undefined,
		headers: new Map(),
		timestamp: 0n,
		async commit() {},
		metadata: {}
	} as unknown as KafkaMessage;
}

/**
 * Yields messages with a real gap between them. The gap matters: an
 * array-backed stream delivers everything in one microtask burst, so the
 * linger timer never gets to fire mid-flush and the race stays hidden.
 */
async function* generateMessages(count: number, gapMilliseconds: number) {
	for (let index = 1; index <= count; index += 1) {
		await wait(gapMilliseconds);
		yield buildMessage(index);
	}
}

/** A consumer that reads the given stream: generated, or one a test pushes into. */
function buildConsumer(stream: Readable) {
	return {
		async consume() {
			return stream;
		}
	} as unknown as KafkaConsumer;
}

/** A consumer that keeps the options each consume() call was given. */
function buildRecordingConsumer(
	stream: Readable,
	consumeCalls: Array<{ maxBytes?: number }>
) {
	return {
		async consume(options: { maxBytes?: number }) {
			consumeCalls.push(options);
			return stream;
		}
	} as unknown as KafkaConsumer;
}

function buildOptions(
	over: Partial<BatchConsumerOptions> = {}
): BatchConsumerOptions {
	return {
		topics: ["transactions"],
		mode: "latest",
		maxWaitTime: 100,
		fetchMaxBytes: 1_048_576,
		batchSize: 3,
		// Shorter than the handler's work, so the linger timer fires while a
		// size-triggered flush is still awaiting — the race window.
		lingerMs: 1,
		...over
	};
}

// The messages here always deserialise, so the stream never calls this.
function continueAfterDeserialisationError() {
	return "continue" as never;
}

/** Every offset the handler was given, in the order it was given them. */
function readHandledOffsets(onBatch: Mock<BatchHandler>) {
	const offsets: bigint[] = [];
	for (const call of onBatch.mock.calls) {
		for (const message of call.arguments[0]) {
			offsets.push(message.offset);
		}
	}
	return offsets;
}

suite("startBatchConsumer", () => {
	test("never runs two flushes concurrently", async () => {
		let active = 0;
		let maxActive = 0;
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await wait(20);
			active -= 1;
		});

		await startBatchConsumer(
			buildConsumer(Readable.from(generateMessages(7, 5))),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions()
		);

		assert.equal(maxActive, 1, "flushes must not overlap");
		assert.deepEqual(
			readHandledOffsets(onBatch),
			[1n, 2n, 3n, 4n, 5n, 6n, 7n],
			"every message is handled exactly once, in order"
		);
	});

	// The client pushes a whole fetch into its buffer before backpressure
	// applies, so the fetch size is what bounds the consumer's memory under a
	// backlog. Left to the client's 50 MB default, one fetch held about 144,000
	// card records and the consumer was OOM-killed.
	test("asks for at most fetchMaxBytes in each fetch", async () => {
		const consumeCalls: Array<{ maxBytes?: number }> = [];

		await startBatchConsumer(
			buildRecordingConsumer(
				Readable.from(generateMessages(1, 1)),
				consumeCalls
			),
			mock.fn(async (_messages: ClassifiedMessage[]) => {}),
			continueAfterDeserialisationError,
			buildOptions({ fetchMaxBytes: 262_144 })
		);

		assert.strictEqual(consumeCalls[0]?.maxBytes, 262_144);
	});

	test("flushes the trailing partial batch when the stream ends", async () => {
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {});

		// 4 messages with batchSize 3 leaves one buffered at stream end.
		await startBatchConsumer(
			buildConsumer(Readable.from(generateMessages(4, 1))),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions({ lingerMs: 10_000 })
		);

		assert.deepEqual(
			readHandledOffsets(onBatch),
			[1n, 2n, 3n, 4n],
			"the 4th must not be dropped"
		);
	});

	test("a failed linger flush ends the consumer with that error", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		const failure = new Error("database unavailable");

		const consuming = startBatchConsumer(
			buildConsumer(stream),
			async () => {
				throw failure;
			},
			continueAfterDeserialisationError,
			buildOptions({ batchSize: 10, lingerMs: 1 })
		);

		stream.push(buildMessage(1));

		await assert.rejects(consuming, failure);
	});
});

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function buildIncomingHeaders() {
	return new Map([
		["traceparent", TRACEPARENT],
		["x-producer", "producers/0.1.0"]
	]);
}

suite("classifyMessages", () => {
	test("a valid message keeps its decoded value, raw bytes and headers", () => {
		const raw = Buffer.from("framed avro");
		const value = { transactionId: "t1" } as unknown as DomainTransactionSchema;
		const headers = buildIncomingHeaders();
		const consumed = {
			...buildMessage(1),
			value: { raw, value },
			headers
		} as unknown as KafkaMessage;

		const [classified] = classifyMessages([consumed]);

		assert.equal(classified?.kind, "valid");
		if (classified?.kind !== "valid") return;
		assert.strictEqual(classified.value, value);
		assert.strictEqual(classified.raw, raw);
		assert.strictEqual(classified.headers, headers);
	});

	test("a poison message keeps its raw bytes and headers", () => {
		const raw = Buffer.from("not avro");
		const consumed = {
			...buildMessage(2),
			value: raw,
			headers: buildIncomingHeaders(),
			metadata: {
				deserializationError: { error: new Error("bad"), payloadType: "value" }
			}
		} as unknown as KafkaMessage;

		const [classified] = classifyMessages([consumed]);

		assert.equal(classified?.kind, "poison");
		if (classified?.kind !== "poison") return;
		assert.strictEqual(classified.raw, raw);
		assert.equal(classified.headers.get("traceparent"), TRACEPARENT);
	});
});

interface SentRecord {
	key: string;
	value: Buffer;
	headers: Record<string, string>;
}

/** The fake producer's send: accepts every request, recorded by `mock.fn`. */
async function acceptRecords(_request: { messages: SentRecord[] }) {}

function readSentRecords(send: Mock<typeof acceptRecords>) {
	const records: SentRecord[] = [];
	for (const call of send.mock.calls) {
		for (const record of call.arguments[0].messages) {
			records.push(record);
		}
	}
	return records;
}

function buildValidFailure(
	error: unknown,
	headers = buildIncomingHeaders()
): DeadLetterFailure {
	return {
		message: {
			topic: "transactions.card",
			partition: 3,
			offset: 42n,
			headers,
			kind: "valid",
			value: { transactionId: "t1" } as unknown as DomainTransactionSchema,
			raw: Buffer.from("framed avro"),
			recordTimestamp: 0
		},
		error
	};
}

function buildPoisonFailure(error: unknown): DeadLetterFailure {
	return {
		message: {
			topic: "transactions.card",
			partition: 3,
			offset: 43n,
			headers: buildIncomingHeaders(),
			kind: "poison",
			raw: Buffer.from("not avro"),
			error
		},
		error
	};
}

suite("createDeadLetterSender", () => {
	test("a record is dead-lettered as it arrived, with the DLQ headers on top", async () => {
		const send = mock.fn(acceptRecords);
		const headers = buildIncomingHeaders();
		headers.set("x-dlq-reason", "from an earlier redrive");
		const failure = buildValidFailure(
			new NonRetryableError("status outside the enum"),
			headers
		);

		const sendToDeadLetterQueue = createDeadLetterSender(
			{ send } as unknown as DeadLetterProducer,
			"transactions.card.dlq"
		);

		await sendToDeadLetterQueue([failure]);

		const [record] = readSentRecords(send);
		assert.equal(record?.key, "transactions.card-3-42");
		assert.deepEqual(record?.value, Buffer.from("framed avro"));
		assert.deepEqual(record?.headers, {
			traceparent: TRACEPARENT,
			"x-producer": "producers/0.1.0",
			"x-dlq-reason": "processing",
			"x-dlq-error": "status outside the enum",
			"x-source-topic": "transactions.card",
			"x-source-partition": "3",
			"x-source-offset": "42"
		});
	});

	test("a poison record keeps its raw bytes and headers, reason deserialisation", async () => {
		const send = mock.fn(acceptRecords);

		const sendToDeadLetterQueue = createDeadLetterSender(
			{ send } as unknown as DeadLetterProducer,
			"transactions.card.dlq"
		);

		await sendToDeadLetterQueue([
			buildPoisonFailure(new Error("Not Confluent wire format"))
		]);

		const [record] = readSentRecords(send);
		assert.deepEqual(record?.value, Buffer.from("not avro"));
		assert.equal(record?.headers.traceparent, TRACEPARENT);
		assert.equal(record?.headers["x-dlq-reason"], "deserialisation");
	});
});
