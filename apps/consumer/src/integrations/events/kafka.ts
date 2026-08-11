import { fileLogger } from "../../runtime.ts";

const logger = fileLogger(import.meta.url);

// Create consumer client singleton
// import { SchemaRegistry } from "@platformatic/kafka";
import {
	type ConsumeOptions,
	Consumer,
	type ConsumerOptions,
	MessagesStreamFallbackModes,
	MessagesStreamModes
} from "@platformatic/kafka";

export function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>
): Consumer<Key, Value, HeaderKey, HeaderValue> {
	return new Consumer(options);
}

export async function startBatchConsumer(
	consumer: ReturnType<typeof createKafkaConsumer>,
	topics: string[],
	// batchHandler: () => void
	options?: Partial<ConsumeOptions<unknown, unknown, unknown, unknown>>
) {
	const messageStream = await consumer.consume({
		topics: topics,
		// COMMITTED is the only mode that reads the group's committed offsets;
		// every other mode ignores them and re-reads from the log ends.
		mode: MessagesStreamModes.COMMITTED,
		// Using the Earlies fallback method will read all messages if none were comitted
		fallbackMode: MessagesStreamFallbackModes.EARLIEST,
		...options,
		autocommit: false
	});

	// Creating our own batch handler
	const BATCH_SIZE = 100;
	const MAX_BATCH_TIME_MS = 2000;
	let timeoutId: NodeJS.Timeout | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: # TODO: implement types
	let messageBatch: any[] = []; // TODO: this should be the deserialised payload

	async function flushBatch(): Promise<void> {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		if (messageBatch.length === 0) return;

		// Taken before the first await so a timer firing mid-flush cannot
		// process the same messages twice.
		const batch = messageBatch;
		messageBatch = [];

		logger.info(`Processing a batch of ${batch.length} messages...`);

		try {
			console.log(batch);
			// Commit only once the batch is durably handled. Every message
			// carries its own commit bound to its offset + 1, so committing the
			// last one covers the batch.
			// await batch[batch.length - 1].commit();
		} catch (error) {
			// This also runs from a timer, where an uncaught throw would take
			// the process down. Nothing was committed, so the batch is replayed
			// on the next run.
			logger.error({ error, size: batch.length }, "Failed to process batch");
		}
	}

	for await (const message of messageStream) {
		console.log("HERE:", message);
		messageBatch.push(message);

		// First message of a batch starts the clock, so a partial batch still
		// gets processed on a quiet topic.
		if (messageBatch.length === 1) {
			timeoutId = setTimeout(() => {
				void flushBatch();
			}, MAX_BATCH_TIME_MS);
		}

		if (messageBatch.length >= BATCH_SIZE) {
			await flushBatch();
		}
	}

	// The stream ended - whatever is left is still a batch worth processing.
	await flushBatch();
}
