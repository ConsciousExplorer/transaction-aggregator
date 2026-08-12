import type { Pool } from "pg";
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
	const kafkaConsumer = new Consumer(options);

	// Register listerners
	kafkaConsumer.addListener("consumer:group:rebalance", () =>
		console.log("Preparing a rebalance")
	);
	return kafkaConsumer;
}

export async function startBatchConsumer(
	consumer: ReturnType<typeof createKafkaConsumer>,
	topics: string[],
	pool: Pool,
	// biome-ignore lint/suspicious/noExplicitAny: // TODO: implement message boundary
	batchHandler: (pool: Pool, messages: any) => Promise<void>,
	options?: Partial<ConsumeOptions<unknown, unknown, unknown, unknown>>
) {
	const messageStream = await consumer.consume({
		topics: topics,
		// COMMITTED is the only mode that reads the group's committed offsets;
		// every other mode ignores them and re-reads from the log ends.
		// TODO: change to commited when we are done testing, enabling this setting means we read from the beginning always
		mode: MessagesStreamModes.EARLIEST,
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

		try {
			await batchHandler(pool, messageBatch);
			// Commit only once the batch is durably handled. Every message
			await messageBatch[messageBatch.length - 1].commit();
			messageBatch = [];
		} catch (error) {
			// This also runs from a timer, where an uncaught throw would take
			// the process down. Nothing was committed, so the batch is replayed
			// on the next run.
			logger.error(
				{ error, size: messageBatch.length },
				"Failed to process batch"
			);
		}
	}

	for await (const message of messageStream) {
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
