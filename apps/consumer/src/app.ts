/**
 * App main entrypoint
 */
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import type { CardTransaction } from "./generated/card.ts";
import { createPool } from "./integrations/database/postgres.ts";
import { loadActiveRules } from "./integrations/database/respository/rule-repository.ts";
import { createAvroDeserializer } from "./integrations/events/avro-deserializer.ts";
import { transactionBatchHandler } from "./integrations/events/handlers/batchHandler.ts";
import { deserializationErrorHandler } from "./integrations/events/handlers/deserialisationHandler.ts";
import {
	type CardConsumer,
	createKafkaConsumer,
	createKafkaDlqProducer,
	type DlqProducer,
	startBatchConsumer
} from "./integrations/events/kafka.ts";
import { config, fileLogger } from "./runtime.ts";

const logger = fileLogger(import.meta.url);

// Dependencies
let writerPool: Pool;
let kafkaConsumer: CardConsumer;
let kafkaDlqProducer: DlqProducer;

export async function startupCheck<T>(
	name: string,
	action: () => Promise<T>
): Promise<T> {
	const start = performance.now();

	try {
		const result = await action();

		logger.info(
			`Dependency: ${name} (${Math.round(performance.now() - start)}ms)`
		);

		return result;
	} catch (err) {
		logger.error({ err }, `✗ ${name}`);
		process.exit(1);
	}
}

export async function gracefulShutdown(code = 0): Promise<never> {
	// Consumer first: close() sends LeaveGroup, which is what stops the next
	// start from waiting out the session timeout on a zombie member.
	try {
		await kafkaConsumer.close();
	} catch (err) {
		logger.error({ err }, "Consumer close failed");
	}

	try {
		await writerPool?.end();
	} catch (err) {
		logger.error({ err }, "Pool close failed");
	}

	try {
		await kafkaDlqProducer.close();
	} catch (err) {
		logger.error({ err }, "Producer close failed");
	}

	process.exit(code);
}

// #region: Kill Processes
process.on("SIGTERM", () => void gracefulShutdown());
process.on("SIGINT", () => void gracefulShutdown());

await startupCheck(
	"test",
	() => new Promise((resolve) => setTimeout(resolve, 2000))
);
// #endregion

// #region: Main entrypoint
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

	const rules = await loadActiveRules(writerPool);
	logger.info(`Loaded ${rules.length} rules`);

	const avroDeserializer = await startupCheck("SchemaRegistry", () =>
		createAvroDeserializer<CardTransaction>(config.schemaRegistry.url, [
			"transactions.card-value"
		])
	);

	kafkaConsumer = await createKafkaConsumer({
		groupId: config.kafka.groupId,
		clientId: `${config.kafka.clientId}_consumer`,
		bootstrapBrokers: config.kafka.brokers,

		// Kafka group membership
		sessionTimeout: config.kafka.sessionTimeout,
		heartbeatInterval: config.kafka.heartbeatInterval, // 5_000
		rebalanceTimeout: config.kafka.rebalanceTimeout, // 30_000
		requestTimeout: config.kafka.requestTimeout,

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

	kafkaDlqProducer = await createKafkaDlqProducer({
		clientId: `${config.kafka.clientId}_producer`,
		bootstrapBrokers: config.kafka.brokers,
		sasl: {
			mechanism: config.kafka.sasl.mechanism,
			username: config.kafka.sasl.username,
			password: config.secrets.kafka_password
		}
	});
} catch (err) {
	logger.error({ err }, "Startup failed");
	await gracefulShutdown(1);
	process.exit(1);
}

try {
	logger.info(
		{ topics: config.kafka.topics.card, mode: config.kafka.readMode },
		"Starting consumer"
	);

	await startBatchConsumer(
		kafkaConsumer,
		kafkaDlqProducer,
		config.kafka.topics.dlq,
		writerPool,
		transactionBatchHandler,
		deserializationErrorHandler,
		{
			topics: config.kafka.topics.card,
			mode: config.kafka.readMode,
			maxWaitTime: config.kafka.maxWaitTime,
			batchSize: config.kafka.batchSize,
			lingerMs: config.kafka.lingerMs,
			maxRetries: config.kafka.maxRetries,
			retryBaseDelayMs: config.kafka.retryBaseDelayMs
		}
	);
} catch (err) {
	logger.error({ err }, "Consumer stopped on an unrecoverable error");
	await gracefulShutdown(1);
}

// #endregion
