import assert from "node:assert";
import { Readable } from "node:stream";
import { suite, test } from "node:test";
import { NonRetryableError } from "#src/errors/consumer-errors.ts";
import type { DomainTransactionSchema } from "#src/schemas/transaction.ts";
import type {
	ClassifiedMessage,
	DlqFailure
} from "./handlers/transactionBatchHandler.ts";
import {
	type BatchConsumerOptions,
	classifyMessages,
	createDlqSender,
	type DlqProducer,
	type KafkaConsumer,
	type KafkaMessage,
	startBatchConsumer
} from "./kafka.ts";

function message(offset: number): KafkaMessage {
	let committed = false;

	return {
		topic: "transactions",
		partition: 0,
		offset: BigInt(offset),
		key: `k${offset}`,
		value: undefined,
		headers: new Map(),
		timestamp: 0n,
		commit: async () => {
			committed = true;
		},
		get committed() {
			return committed;
		},
		metadata: {}
	} as unknown as KafkaMessage;
}

/**
 * A consumer that yields messages with a real gap between them. The gap matters:
 * an array-backed stream delivers everything in one microtask burst, so the
 * linger timer never gets to fire mid-flush and the race stays hidden.
 */
function fakeConsumer(count: number, gapMs = 0): KafkaConsumer {
	async function* messages() {
		for (let index = 1; index <= count; index += 1) {
			if (gapMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, gapMs));
			}
			yield message(index);
		}
	}

	return {
		consume: async () => Readable.from(messages())
	} as unknown as KafkaConsumer;
}

/** A stream that stays open, like a live topic, until the test pushes into it. */
function openConsumer(stream: Readable): KafkaConsumer {
	return { consume: async () => stream } as unknown as KafkaConsumer;
}

const options = (over: Partial<BatchConsumerOptions> = {}) =>
	({
		topics: ["transactions"],
		mode: "latest",
		maxWaitTime: 100,
		batchSize: 3,
		// Shorter than the handler's work, so the linger timer fires while a
		// size-triggered flush is still awaiting — the race window.
		lingerMs: 1,
		...over
	}) as BatchConsumerOptions;

suite("startBatchConsumer", () => {
	test("never runs two flushes concurrently", async () => {
		let active = 0;
		let maxActive = 0;
		const seen: bigint[] = [];

		async function onBatch(messages: ClassifiedMessage[]) {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 20));
			for (const item of messages) seen.push(item.offset);
			active -= 1;
		}

		await startBatchConsumer(
			fakeConsumer(7, 5),
			onBatch,
			() => "continue" as never,
			options()
		);

		assert.equal(maxActive, 1, "flushes must not overlap");
		assert.deepEqual(
			seen,
			[1n, 2n, 3n, 4n, 5n, 6n, 7n],
			"every message is handled exactly once, in order"
		);
	});

	test("flushes the trailing partial batch when the stream ends", async () => {
		const seen: bigint[] = [];

		// 4 messages with batchSize 3 leaves one buffered at stream end.
		await startBatchConsumer(
			fakeConsumer(4, 1),
			async (messages) => {
				for (const item of messages) seen.push(item.offset);
			},
			() => "continue" as never,
			options({ lingerMs: 10_000 })
		);

		assert.deepEqual(seen, [1n, 2n, 3n, 4n], "the 4th must not be dropped");
	});

	test("a failed linger flush ends the consumer with that error", async () => {
		const stream = new Readable({ objectMode: true, read() {} });
		const failure = new Error("database unavailable");

		const consuming = startBatchConsumer(
			openConsumer(stream),
			async () => {
				throw failure;
			},
			() => "continue" as never,
			options({ batchSize: 10, lingerMs: 1 })
		);

		stream.push(message(1));

		await assert.rejects(consuming, failure);
	});
});

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function incomingHeaders(): Map<string, string> {
	return new Map([
		["traceparent", TRACEPARENT],
		["x-producer", "producers/0.1.0"]
	]);
}

suite("classifyMessages", () => {
	test("a valid message keeps its decoded value, raw bytes and headers", () => {
		const raw = Buffer.from("framed avro");
		const value = { transactionId: "t1" } as unknown as DomainTransactionSchema;
		const headers = incomingHeaders();
		const consumed = {
			...message(1),
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
			...message(2),
			value: raw,
			headers: incomingHeaders(),
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

function recordingDlqProducer() {
	const sent: SentRecord[] = [];
	const producer = {
		send: async (request: { messages: SentRecord[] }) => {
			for (const record of request.messages) sent.push(record);
		}
	} as unknown as DlqProducer;
	return { sent, producer };
}

function validFailure(error: unknown, headers = incomingHeaders()): DlqFailure {
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

function poisonFailure(error: unknown): DlqFailure {
	return {
		message: {
			topic: "transactions.card",
			partition: 3,
			offset: 43n,
			headers: incomingHeaders(),
			kind: "poison",
			raw: Buffer.from("not avro"),
			error
		},
		error
	};
}

suite("createDlqSender", () => {
	test("a record is dead-lettered as it arrived, with the DLQ headers on top", async () => {
		const dlq = recordingDlqProducer();
		const headers = incomingHeaders();
		headers.set("x-dlq-reason", "from an earlier redrive");
		const failure = validFailure(
			new NonRetryableError("status outside the enum"),
			headers
		);

		await createDlqSender(dlq.producer, "transactions.card.dlq")([failure]);

		const [record] = dlq.sent;
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
		const dlq = recordingDlqProducer();

		await createDlqSender(
			dlq.producer,
			"transactions.card.dlq"
		)([poisonFailure(new Error("Not Confluent wire format"))]);

		const [record] = dlq.sent;
		assert.deepEqual(record?.value, Buffer.from("not avro"));
		assert.equal(record?.headers.traceparent, TRACEPARENT);
		assert.equal(record?.headers["x-dlq-reason"], "deserialisation");
	});
});
