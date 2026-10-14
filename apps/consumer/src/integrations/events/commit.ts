export interface CommittableMessage {
	topic: string;
	partition: number;
	offset: bigint;
	commit(): void | Promise<void>;
}

export async function commitBatch(messages: readonly CommittableMessage[]) {
	const highest = new Map<string, CommittableMessage>();
	for (const message of messages) {
		const key = `${message.topic}:${message.partition}`;
		const current = highest.get(key);

		if (!current || message.offset > current.offset) {
			highest.set(key, message);
		}
	}

	const commits = [];
	for (const message of highest.values()) {
		commits.push(message.commit());
	}
	await Promise.all(commits);
}
