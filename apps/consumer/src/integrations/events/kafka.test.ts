import assert from "node:assert";
import { Readable } from "node:stream";
import { suite, test } from "node:test";
import type { ClassifiedMessage } from "./handlers/transactionBatchHandler.ts";
import {
	type BatchConsumerOptions,
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
