/**
 * App main entrypoint
 *
 *
 */
import process from "node:process";
import {
	// type Consumer,
	stringDeserializer
} from "@platformatic/kafka";
import type { Pool } from "pg";
import { createPool } from "./integrations/database/postgres.ts";
import { loadActiveRules } from "./integrations/database/respository/rule-repository.ts";
import { createAvroDeserializer } from "./integrations/events/avro-deserializer.ts";
import { transactionBatchHandler } from "./integrations/events/handlers/batchHandler.ts";
import {
	createKafkaConsumer,
	startBatchConsumer
} from "./integrations/events/kafka.ts";
import { config, fileLogger } from "./runtime.ts";

const logger = fileLogger(import.meta.url);

// Dependencies
let writerPool: Pool | undefined;
// biome-ignore lint/suspicious/noExplicitAny: Define later #TODO
let kafkaConsumer: any;

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
	await kafkaConsumer.close();
	process.exit(0);
}

// #region: Kill Processes
process.on("SIGTERM", async () => {
	await gracefulShudown();
});

process.on("SIGINT", async () => {
	await gracefulShudown();
});

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000))
);

// Create baseLogger

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

	// const rules = await loadActiveRules(writerPool);
	// for (const rule in rules) {
	// 	console.log(rule);
	// }

	const avroDeserializer = await startupCheck("SchemaRegistry", () =>
		createAvroDeserializer(config.schemaRegistry.url, [
			"transactions.card-value"
		])
	);

	kafkaConsumer = createKafkaConsumer({
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

	await startBatchConsumer(
		kafkaConsumer,
		Array(config.kafka.topics.card),
		writerPool,
		transactionBatchHandler
	);
} catch (error) {
	logger.error({ error }, "Startup failed");
}

// #endregion
