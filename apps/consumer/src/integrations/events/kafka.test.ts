import assert from "node:assert";
import { Readable } from "node:stream";
import { type Mock, mock, suite, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import { batchFlushDurationSeconds } from "#src/telemetry/metrics.ts";
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

/** A consumer that reads the given stream: a fixed one, or one a test pushes into. */
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

/** A message whose commit is recorded, so a test can read what was committed. */
function buildCommitRecordingMessage(offset: number) {
	return { ...buildMessage(offset), commit: mock.fn(async () => {}) };
}

function readCommittedOffsets(
	messages: ReturnType<typeof buildCommitRecordingMessage>[]
) {
	const offsets: bigint[] = [];
	for (const message of messages) {
		if (message.commit.mock.callCount() > 0) offsets.push(message.offset);
	}
	return offsets;
}

/**
 * Slow enough that the next batch is queued before the first one fails. Only
 * the batch holding offset 1 fails.
 */
async function failFirstBatchSlowly(messages: ClassifiedMessage[]) {
	await wait(20);
	if (messages[0]?.offset === 1n) throw new Error("database unavailable");
}

/** The histogram is a process-wide singleton, so tests compare before/after. */
async function countFlushDurationObservations() {
	const metric = await batchFlushDurationSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "batch_flush_duration_seconds_count") {
			return value.value;
		}
	}
	return 0;
}

async function waitForHandlerCalls(onBatch: Mock<BatchHandler>, count: number) {
	while (onBatch.mock.callCount() < count) {
		await wait(1);
	}
}

async function waitForHandledOffsets(
	onBatch: Mock<BatchHandler>,
	count: number
) {
	while (readHandledOffsets(onBatch).length < count) {
		await wait(1);
	}
}

suite("startBatchConsumer", () => {
	test("never runs two flushes concurrently", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		let active = 0;
		let maxActive = 0;
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await wait(20);
			active -= 1;
		});

		const consuming = startBatchConsumer(
			buildConsumer(stream),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions()
		);

		// A real gap between messages: pushed all at once, they arrive in one
		// microtask burst, the linger timer never fires mid-flush, and the race
		// stays hidden
		for (let offset = 1; offset <= 7; offset += 1) {
			await wait(5);
			stream.push(buildMessage(offset));
		}
		// Ended only once every message is handled: a batch still buffered when
		// the stream ends is left for the restart
		await waitForHandledOffsets(onBatch, 7);
		stream.push(null);
		await consuming;

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
			buildRecordingConsumer(Readable.from([buildMessage(1)]), consumeCalls),
			mock.fn(async (_messages: ClassifiedMessage[]) => {}),
			continueAfterDeserialisationError,
			buildOptions({ fetchMaxBytes: 262_144 })
		);

		assert.strictEqual(consumeCalls[0]?.maxBytes, 262_144);
	});

	// The stream ends only when shutdown closes the consumer, which can no longer
	// commit. A flush then would store rows whose offsets are never committed, so
	// the partial batch is left for the restart to read again.
	test("leaves a trailing partial batch for the restart when the stream ends", async () => {
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {});
		const messages = [
			buildMessage(1),
			buildMessage(2),
			buildMessage(3),
			buildMessage(4)
		];

		// 4 messages with batchSize 3 leave one buffered when the stream ends
		await startBatchConsumer(
			buildConsumer(Readable.from(messages)),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions({ lingerMs: 10_000 })
		);

		assert.deepEqual(readHandledOffsets(onBatch), [1n, 2n, 3n]);
	});

	test("a failed linger flush ends the consumer with that error", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		const failure = new Error("database unavailable");
		const flushesTimedBefore = await countFlushDurationObservations();

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
		// A slow failure shows in the flush duration too
		assert.equal(
			await countFlushDurationObservations(),
			flushesTimedBefore + 1
		);
	});

	// A failed batch was never stored, so nothing may commit past it: the
	// restart must read it again. Committing a later batch moves the group's
	// offset beyond it, and its messages are skipped for good.
	test("a flush queued behind a failed linger flush neither handles nor commits its batch", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		const messages = [
			buildCommitRecordingMessage(1),
			buildCommitRecordingMessage(2),
			buildCommitRecordingMessage(3),
			buildCommitRecordingMessage(4)
		];
		const onBatch = mock.fn(failFirstBatchSlowly);

		const consuming = startBatchConsumer(
			buildConsumer(stream),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions({ batchSize: 3, lingerMs: 1 })
		);

		// Offset 1 alone: the linger timer flushes it, and the handler is slow
		stream.push(messages[0]);
		await waitForHandlerCalls(onBatch, 1);
		// A full batch while that flush runs, so a size flush queues behind it
		stream.push(messages[1]);
		stream.push(messages[2]);
		stream.push(messages[3]);

		await assert.rejects(consuming, /database unavailable/);
		assert.deepEqual(readHandledOffsets(onBatch), [1n]);
		assert.deepEqual(readCommittedOffsets(messages), []);
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

	test("every message keeps its key and when it was produced, for the DLQ", () => {
		const consumed = {
			...buildMessage(3),
			key: CUSTOMER_ID,
			timestamp: BigInt(PRODUCED_AT)
		} as unknown as KafkaMessage;

		const [classified] = classifyMessages([consumed]);

		assert.equal(classified?.kind, "tombstone");
		assert.equal(classified?.key, CUSTOMER_ID);
		assert.equal(classified?.recordTimestamp, PRODUCED_AT);
	});
});

interface SentRecord {
	key?: string;
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

// The producer's partition key, and when it produced the record
const CUSTOMER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRODUCED_AT = 1_790_000_000_000;

function buildValidFailure(
	error: unknown,
	headers = buildIncomingHeaders()
): DeadLetterFailure {
	return {
		message: {
			topic: "transactions.card",
			partition: 3,
			offset: 42n,
			key: CUSTOMER_ID,
			recordTimestamp: PRODUCED_AT,
			headers,
			kind: "valid",
			value: { transactionId: "t1" } as unknown as DomainTransactionSchema,
			raw: Buffer.from("framed avro")
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
			key: CUSTOMER_ID,
			recordTimestamp: PRODUCED_AT,
			headers: buildIncomingHeaders(),
			kind: "poison",
			raw: Buffer.from("not avro"),
			error
		},
		error
	};
}

suite("createDeadLetterSender", () => {
	// The original key, so a redrive produces it onto the customer's partition
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
		assert.equal(record?.key, CUSTOMER_ID);
		assert.deepEqual(record?.value, Buffer.from("framed avro"));
		assert.deepEqual(record?.headers, {
			traceparent: TRACEPARENT,
			"x-producer": "producers/0.1.0",
			"x-dlq-reason": "processing",
			"x-dlq-error": "status outside the enum",
			"x-source-topic": "transactions.card",
			"x-source-partition": "3",
			"x-source-offset": "42",
			"x-source-timestamp": String(PRODUCED_AT)
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
		assert.equal(record?.key, CUSTOMER_ID);
		assert.deepEqual(record?.value, Buffer.from("not avro"));
		assert.equal(record?.headers.traceparent, TRACEPARENT);
		assert.equal(record?.headers["x-dlq-reason"], "deserialisation");
	});
});
