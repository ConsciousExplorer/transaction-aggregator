import { fileLogger } from "../../runtime.ts";

const logger = fileLogger(import.meta.url);

// Create consumer client singleton
// import { SchemaRegistry } from "@platformatic/kafka";
import { Consumer, type ConsumerOptions } from "@platformatic/kafka";

export function createKafkaConsumer<Key, Value, HeaderKey, HeaderValue>(
	options: ConsumerOptions<Key, Value, HeaderKey, HeaderValue>
): Consumer<Key, Value, HeaderKey, HeaderValue> {
	return new Consumer(options);
}

export async function startConsumer() {
	logger.info("TODO");
}
