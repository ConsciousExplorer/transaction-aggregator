// Create consumer client singleton
// import { Consumer, ConsumerOptions, Deserializers } from "@platformatic/kafka";
import { SchemaRegistry } from "@platformatic/kafka";

// export function createKafkaConsumer(
// 	config: ConsumerOptions<string, string, string, string>,
// 	deserializers: Deserializers<string, string, string, string>
// ): Consumer {
// 	const consumer = new Consumer({
// 		groupId: config.groupId,
// 		clientId: config.clientId,
// 		bootstrapBrokers: config.bootstrapBrokers,
// 		deserializers: stringDeserializers
// 	});
// 	return consumer;
// }
