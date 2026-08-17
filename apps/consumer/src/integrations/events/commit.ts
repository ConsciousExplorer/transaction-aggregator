export interface CommittableMessage {
	topic: string;
	partition: number;
	offset: bigint;
	commit(): void | Promise<void>;
}

export async function commitBatch(
	messages: readonly CommittableMessage[]
): Promise<void> {
	const highest = new Map<string, CommittableMessage>();
	for (const message of messages) {
		const key = `${message.topic}:${message.partition}`;
		const current = highest.get(key);

		if (!current || message.offset > current.offset) {
			highest.set(key, message);
		}
	}

	await Promise.all([...highest.values()].map((message) => message.commit()));
}
