import assert from "node:assert/strict";
import { mock, suite, test } from "node:test";
import { commitBatch } from "./commit.ts";

function buildMessage(topic: string, partition: number, offset: number) {
	return {
		topic,
		partition,
		offset: BigInt(offset),
		commit: mock.fn(async () => {})
	};
}

function readCommitted(messages: ReturnType<typeof buildMessage>[]) {
	const committed: string[] = [];
	for (const message of messages) {
		if (message.commit.mock.callCount() > 0) {
			committed.push(`${message.topic}:${message.partition}@${message.offset}`);
		}
	}
	return committed;
}

suite("commitBatch", () => {
	test("commits each partition once, at its highest offset in the batch", async () => {
		const messages = [
			buildMessage("transactions.card", 0, 10),
			buildMessage("transactions.card", 1, 7),
			buildMessage("transactions.card", 0, 12),
			buildMessage("transactions.card", 0, 11),
			buildMessage("transactions.card", 1, 8)
		];

		await commitBatch(messages);

		assert.deepStrictEqual(readCommitted(messages), [
			"transactions.card:0@12",
			"transactions.card:1@8"
		]);
	});

	test("the same partition number on another topic is a partition of its own", async () => {
		const messages = [
			buildMessage("transactions.card", 0, 10),
			buildMessage("transactions.eft", 0, 3)
		];

		await commitBatch(messages);

		assert.deepStrictEqual(readCommitted(messages), [
			"transactions.card:0@10",
			"transactions.eft:0@3"
		]);
	});
});
