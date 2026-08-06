/**
 * App main entrypoint
 *
 *
 */
import process from "node:process";
import { MessagesStreamModes, stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import { createPool } from "./integrations/database/postgres.ts";
import { createAvroDeserializer } from "./integrations/events/avro-deserializer.ts";
import { createKafkaConsumer } from "./integrations/events/kafka.ts";
import { baseLogger, config } from "./utils/index.ts";

const logger = baseLogger;

// Dependencies
let writerPool: Pool;

export async function startupCheck<T>(
	name: string,
	action: () => Promise<T>
): Promise<T> {
	const start = performance.now();

	try {
		const result = await action();

		logger.info(`✓ ${name} (${Math.round(performance.now() - start)}ms)`);

		return result;
	} catch (err) {
		logger.error({ err }, `✗ ${name}`);
		process.exit(1);
	}
}

export async function gracefulShudown() {
	await writerPool?.end();
	process.exit(0);
}

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000))
);

// Create Logger

try {
	// Create database pool to manage connections
	writerPool = await startupCheck("PostgreSQL", () =>
		createPool({
			min: config.database.min,
			max: config.database.max,
			database: config.database.database,
			host: config.database.host,
			port: config.database.port,
			user: config.database.user,
			password: config.secrets.database_password
		})
	);

	const avroDeserializer = await createAvroDeserializer(
		config.schemaRegistry.url,
		["transactions.card-value"]
	);

	const kafkaConsumer = createKafkaConsumer({
		groupId: config.kafka.groupId,
		clientId: config.kafka.clientId,
		bootstrapBrokers: Array(config.kafka.brokers),
		sasl: {
			mechanism: config.kafka.sasl.mechanism,
			username: config.kafka.sasl.username,
			password: config.secrets.kafka_password
		},
		deserializers: {
			key: stringDeserializer,
			value: avroDeserializer,
			headerKey: stringDeserializer,
			headerValue: stringDeserializer
		}
	});

	const stream = await kafkaConsumer.consume({
		mode: MessagesStreamModes.EARLIEST,
		autocommit: true,
		topics: [config.kafka.topics.card],
		sessionTimeout: 10000,
		heartbeatInterval: 500
	});

	// Async iterator consumption
	for await (const message of stream) {
		// console.log(`Received: ${message.key} -> ${message.value}`);
		baseLogger.info(message);
		// Process message...
	}
} catch (error) {
	baseLogger.error({ error }, "Startup failed");
}

// #region Graceful shutdown
process.on("SIGTERM", async () => {
	await gracefulShudown();
});
