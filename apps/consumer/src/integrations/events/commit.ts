export interface CommittableMessage {
	topic: string;
	partition: number;
	offset: bigint;
	commit(): void | Promise<void>;
}

/** Where in `messages` the message from the same partition is, or -1. */
function findSamePartition(
	messages: readonly CommittableMessage[],
	message: CommittableMessage
) {
	for (let index = 0; index < messages.length; index += 1) {
		const candidate = messages[index];
		if (
			candidate?.topic === message.topic &&
			candidate.partition === message.partition
		) {
			return index;
		}
	}
	return -1;
}

/**
 * Commits each partition once, at the batch's highest offset on it: that
 * commit covers every message before it on the partition.
 */
export async function commitBatch(messages: readonly CommittableMessage[]) {
	const highest: CommittableMessage[] = [];
	for (const message of messages) {
		const index = findSamePartition(highest, message);
		const current = index === -1 ? undefined : highest[index];

		if (current === undefined) {
			highest.push(message);
		} else if (message.offset > current.offset) {
			highest[index] = message;
		}
	}

	const commits = [];
	for (const message of highest) {
		commits.push(message.commit());
	}
	await Promise.all(commits);
}
