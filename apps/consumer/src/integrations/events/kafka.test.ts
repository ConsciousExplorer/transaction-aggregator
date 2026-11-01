import assert from "node:assert";
import { Readable } from "node:stream";
import { type Mock, mock, suite, test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import {
	batchFlushDurationSeconds,
	batchFlushTotal
} from "#src/telemetry/metrics.ts";
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

function buildMessages(count: number) {
	const messages: KafkaMessage[] = [];
	for (let offset = 1; offset <= count; offset += 1) {
		messages.push(buildMessage(offset));
	}
	return messages;
}

function readOffsets(messages: KafkaMessage[]) {
	const offsets: bigint[] = [];
	for (const message of messages) {
		offsets.push(message.offset);
	}
	return offsets;
}

/**
 * A stream holding one fetch. The client pushes every record of a fetch before
 * the consume loop sees any of them, so the test pushes them all at once.
 */
function buildFetchedStream(messages: KafkaMessage[]) {
	const stream = new Readable({ objectMode: true, read() {} });
	for (const message of messages) {
		stream.push(message);
	}
	return stream;
}

/** A consumer that reads the given stream: a fixed one, or one a test pushes into. */
function buildConsumer(stream: Readable) {
	return {
		async consume() {
			return stream;
		}
	} as unknown as KafkaConsumer;
}

interface RecordedConsumeOptions {
	minBytes?: number;
	maxBytes?: number;
	maxWaitTime?: number;
}

/** A consumer that keeps the options each consume() call was given. */
function buildRecordingConsumer(
	stream: Readable,
	consumeCalls: RecordedConsumeOptions[]
) {
	return {
		async consume(options: RecordedConsumeOptions) {
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
		fetchMinBytes: 1,
		fetchMaxBytes: 1_048_576,
		batchSize: 100,
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

/** How many messages each handler call was given, in call order. */
function readBatchSizes(onBatch: Mock<BatchHandler>) {
	const sizes: number[] = [];
	for (const call of onBatch.mock.calls) {
		sizes.push(call.arguments[0].length);
	}
	return sizes;
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

/** A message whose commit fails as the broker would fail it. */
function buildCommitFailingMessage(offset: number, failure: Error) {
	return {
		...buildMessage(offset),
		async commit() {
			throw failure;
		}
	};
}

/** The metrics are process-wide singletons, so tests compare before and after. */
async function countFlushDurationObservations() {
	const metric = await batchFlushDurationSeconds.get();
	for (const value of metric.values) {
		if (value.metricName === "batch_flush_duration_seconds_count") {
			return value.value;
		}
	}
	return 0;
}

async function countFlushes(trigger: string) {
	const metric = await batchFlushTotal.get();
	for (const value of metric.values) {
		if (value.labels.trigger === trigger) {
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

suite("startBatchConsumer", () => {
	// The client pushes a whole fetch into the stream before the loop sees any
	// of it, so an empty stream means the fetch is used up. A batch closes
	// there, or at batchSize, whichever comes first; nothing waits on a timer.
	test("a batch is what one fetch delivered, capped at batchSize", async () => {
		const messages = buildMessages(250);
		const stream = buildFetchedStream(messages);
		stream.push(null);
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {});
		const sizeFlushesBefore = await countFlushes("size");
		const fetchFlushesBefore = await countFlushes("fetch");

		await startBatchConsumer(
			buildConsumer(stream),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions({ batchSize: 100 })
		);

		assert.deepEqual(readBatchSizes(onBatch), [100, 100, 50]);
		assert.deepEqual(
			readHandledOffsets(onBatch),
			readOffsets(messages),
			"every message is handled exactly once, in order"
		);
		assert.equal(await countFlushes("size"), sizeFlushesBefore + 2);
		assert.equal(await countFlushes("fetch"), fetchFlushesBefore + 1);
	});

	// At a trickle each fetch brings a record or two. Each is flushed and
	// committed as it comes, instead of being held until a batch fills.
	test("a trickle is flushed as it arrives, not held for a full batch", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		const messages = [
			buildCommitRecordingMessage(1),
			buildCommitRecordingMessage(2)
		];
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {});

		const consuming = startBatchConsumer(
			buildConsumer(stream),
			onBatch,
			continueAfterDeserialisationError,
			buildOptions({ batchSize: 100 })
		);

		stream.push(messages[0]);
		await waitForHandlerCalls(onBatch, 1);
		stream.push(messages[1]);
		await waitForHandlerCalls(onBatch, 2);
		stream.push(null);
		await consuming;

		assert.deepEqual(readBatchSizes(onBatch), [1, 1]);
		assert.deepEqual(readCommittedOffsets(messages), [1n, 2n]);
	});

	// The fetch settings are the broker's. minBytes and maxWaitTime are Kafka's
	// own linger: the broker holds a fetch until one of them is met. maxBytes
	// bounds what one fetch holds in memory; at the client's 50 MB default, one
	// fetch held about 144,000 card records and the consumer was OOM-killed.
	test("asks the broker for minBytes, maxWaitTime and at most fetchMaxBytes", async () => {
		const consumeCalls: RecordedConsumeOptions[] = [];

		await startBatchConsumer(
			buildRecordingConsumer(Readable.from([buildMessage(1)]), consumeCalls),
			mock.fn(async (_messages: ClassifiedMessage[]) => {}),
			continueAfterDeserialisationError,
			buildOptions({
				fetchMinBytes: 32_768,
				maxWaitTime: 2_000,
				fetchMaxBytes: 262_144
			})
		);

		assert.equal(consumeCalls[0]?.minBytes, 32_768);
		assert.equal(consumeCalls[0]?.maxWaitTime, 2_000);
		assert.equal(consumeCalls[0]?.maxBytes, 262_144);
	});

	// A failed batch was never stored, so nothing may be handled or committed
	// after it: a later commit would move the group's offset past it, and its
	// messages would be skipped for good. The loop ends with the error, and
	// the restart reads the batch again.
	test("a failed flush ends the consumer with that error, and nothing after it is handled or committed", async () => {
		const failure = new Error("database unavailable");
		const messages = [
			buildCommitRecordingMessage(1),
			buildCommitRecordingMessage(2),
			buildCommitRecordingMessage(3)
		];
		const onBatch = mock.fn(async (_messages: ClassifiedMessage[]) => {
			throw failure;
		});
		const flushesTimedBefore = await countFlushDurationObservations();

		await assert.rejects(
			startBatchConsumer(
				buildConsumer(buildFetchedStream(messages)),
				onBatch,
				continueAfterDeserialisationError,
				buildOptions({ batchSize: 1 })
			),
			failure
		);

		assert.deepEqual(readHandledOffsets(onBatch), [1n]);
		assert.deepEqual(readCommittedOffsets(messages), []);
		// A slow failure shows in the flush duration too
		assert.equal(
			await countFlushDurationObservations(),
			flushesTimedBefore + 1
		);
	});

	// The rows are stored, so the restart re-reads them and the insert skips
	// them as duplicates. Carrying on instead would keep inserting with the
	// group's offsets frozen, and nothing on a dashboard would say so.
	test("a failed commit ends the consumer with that error", async () => {
		const failure = new Error("coordinator not available");

		await assert.rejects(
			startBatchConsumer(
				buildConsumer(Readable.from([buildCommitFailingMessage(1, failure)])),
				mock.fn(async (_messages: ClassifiedMessage[]) => {}),
				continueAfterDeserialisationError,
				buildOptions({ batchSize: 1 })
			),
			failure
		);
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
