import { fileLogger } from "../../runtime.ts";

const logger = fileLogger(import.meta.url);

// Create consumer client singleton
// import { SchemaRegistry } from "@platformatic/kafka";
import {
	type ConsumeOptions,
	Consumer,
	type ConsumerOptions,
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
		// Replays the whole log on every run. This client only reads committed
		// group offsets when mode is COMMITTED, so EARLIEST rewinds even after
		// the group has made progress. The default is LATEST, which shows only
		// what is produced after we connect.
		mode: MessagesStreamModes.COMMITTED,
		...options,
		autocommit: false
	});

	// Creating our own batch handler
	const BATCH_SIZE = 100;
	const MAX_BATCH_TIME_MS = 2000;
	let timeoutId: NodeJS.Timeout | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: # TODO: implement types
	let messageBatch: any[] = []; // TODO: this should be the deserialised payload

	function flushBatch(): void {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}

		logger.info(`Processing a batch of ${messageBatch.length} messages...`);

		try {
			console.log(messageBatch);
			// const lastMessage = messageBatch[messageBatch.length - 1]
			// consumer.commit(lastMessage);
		} catch (error) {
			console.error("Failed to process batch:", error);
			throw error;
		} finally {
			messageBatch = [];
		}
	}

	for await (const message of messageStream) {
		console.log("HERE:", message);
		messageBatch.push(message);

		if (messageBatch.length === 1) {
			timeoutId = setTimeout(() => {
				flushBatch();
			}, MAX_BATCH_TIME_MS);
		}
	}

	if (messageBatch.length >= BATCH_SIZE) {
		flushBatch();
	}

	// console.log(messageBatch);
}
