import type { Server } from "node:http";
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import { createFileLogger } from "#src/logger.ts";
import { config, secrets } from "#src/runtime.ts";
import { createDatabase, createPool } from "./integrations/database/pool.ts";
import { loadRuleset } from "./integrations/database/repositories/rule-repository.ts";
import { createAvroDeserialiser } from "./integrations/events/avro-deserialiser.ts";
import { handleDeserialisationError } from "./integrations/events/handlers/handleDeserialisationError.ts";
import { createTransactionBatchHandler } from "./integrations/events/handlers/transactionBatchHandler.ts";
import {
	createDeadLetterSender,
	createKafkaConsumer,
	createKafkaDeadLetterProducer,
	type DeadLetterProducer,
	type KafkaConsumer,
	startBatchConsumer
} from "./integrations/events/kafka.ts";
import { createServer } from "./integrations/http/server.ts";
import type { DomainTransactionSchema } from "./schemas/transaction.ts";
import { registry } from "./telemetry/metrics.ts";
import { startTracing } from "./telemetry/tracing.ts";

const logger = createFileLogger(import.meta.url);

// Undefined when tracing is disabled
const tracerProvider = startTracing(config.tracing);

/** Everything shutdown closes, in the order it closes them. */
interface Resources {
	kafkaConsumer: KafkaConsumer;
	writerPool: Pool;
	deadLetterProducer: DeadLetterProducer;
	server: Server;
}

/**
 * Logs how long a boot step took. A step that fails stops the process: before
 * the consumer joins its group there is nothing to close, and the restart
 * tries again.
 */
async function runStartupCheck<T>(name: string, action: () => Promise<T>) {
	const start = performance.now();

	try {
		const result = await action();

		logger.info(
			`Dependency: ${name} (${Math.round(performance.now() - start)}ms)`
		);

		return result;
	} catch (error) {
		logger.error({ err: error }, `✗ ${name}`);
		process.exit(1);
	}
}

async function shutDownGracefully(
	resources: Resources,
	code: number
): Promise<never> {
	// Consumer first. force closes the open message stream, which close()
	// otherwise refuses to leave the group over; LeaveGroup is what stops the
	// next start from waiting out the session timeout on a zombie member. A
	// batch cut off here was never committed and is read again after restart.
	try {
		await resources.kafkaConsumer.close(true);
	} catch (error) {
		logger.error({ err: error }, "Consumer close failed");
	}

	try {
		await resources.writerPool.end();
	} catch (error) {
		logger.error({ err: error }, "Pool close failed");
	}

	try {
		await resources.deadLetterProducer.close();
	} catch (error) {
		logger.error({ err: error }, "Producer close failed");
	}

	try {
		resources.server.close();
	} catch (error) {
		logger.error({ err: error }, "Health server close failed");
	}

	try {
		await tracerProvider?.forceFlush();
	} catch (error) {
		logger.error({ err: error }, "Trace flush failed");
	}

	process.exit(code);
}

// #region: Boot
const writerPool = await runStartupCheck("PostgreSQL", async () => {
	const pool = createPool({
		min: config.database.min,
		max: config.database.max,
		database: config.database.database,
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: secrets.databasePassword,
		ssl: config.database.ssl,
		idleTimeoutMillis: config.database.idleTimeout,
		connectionTimeoutMillis: config.database.connectionTimeout,
		statement_timeout: config.database.statementTimeout,
		query_timeout: config.database.queryTimeout,
		keepAliveInitialDelayMillis: config.database.keepAliveDelay
	});

	/** Force a real connection and release client directly */
	await pool.query("SELECT 1");

	return pool;
});

const ruleset = await runStartupCheck("Ruleset", () =>
	loadRuleset(createDatabase(writerPool))
);

const deserialiseValue = await runStartupCheck("SchemaRegistry", () =>
	createAvroDeserialiser<DomainTransactionSchema>(config.schemaRegistry.url, [
		`${config.kafka.topics.main}-value`
	])
);

const kafkaConsumer = createKafkaConsumer(
	{
		groupId: config.kafka.groupId,
		clientId: `${config.kafka.clientId}_consumer`,
		bootstrapBrokers: config.kafka.brokers,

		// Kafka group membership
		sessionTimeout: config.kafka.sessionTimeout,
		heartbeatInterval: config.kafka.heartbeatInterval,
		rebalanceTimeout: config.kafka.rebalanceTimeout,
		requestTimeout: config.kafka.requestTimeout,

		sasl: {
			mechanism: config.kafka.sasl.mechanism,
			username: config.kafka.sasl.username,
			password: secrets.kafkaPassword
		},
		deserializers: {
			key: stringDeserializer,
			value: deserialiseValue,
			headerKey: stringDeserializer,
			headerValue: stringDeserializer
		}
	},
	registry
);

const deadLetterProducer = createKafkaDeadLetterProducer(
	{
		clientId: `${config.kafka.clientId}_producer`,
		bootstrapBrokers: config.kafka.brokers,
		sasl: {
			mechanism: config.kafka.sasl.mechanism,
			username: config.kafka.sasl.username,
			password: secrets.kafkaPassword
		}
	},
	registry
);

// Connects and authenticates both clients, the broker's SELECT 1
await runStartupCheck("Kafka", () =>
	Promise.all([
		deadLetterProducer.metadata({ forceUpdate: true }),
		kafkaConsumer.metadata({ forceUpdate: true })
	])
);

const server = createServer();
server.listen(config.app.port, config.app.host);

const resources: Resources = {
	kafkaConsumer,
	writerPool,
	deadLetterProducer,
	server
};

process.on("SIGTERM", () => void shutDownGracefully(resources, 0));
process.on("SIGINT", () => void shutDownGracefully(resources, 0));
// #endregion

// #region: Consume
const handleTransactionBatch = createTransactionBatchHandler(
	config.transactionType,
	ruleset,
	writerPool,
	createDeadLetterSender(deadLetterProducer, config.kafka.topics.deadLetter)
);

try {
	logger.info(
		{ topic: config.kafka.topics.main, mode: config.kafka.readMode },
		"Starting consumer"
	);

	/**
	 * Used for metrics and tracing.
	 * The consumer's lag is the difference between the last offset in the partition and the last offset the consumer has committed.
	 * This is a measure of how far behind the consumer is in processing messages from the topic.
	 */
	kafkaConsumer.startLagMonitoring(
		{ topics: [config.kafka.topics.main] },
		config.kafka.lagMonitoringInterval
	);

	await startBatchConsumer(
		kafkaConsumer,
		handleTransactionBatch,
		handleDeserialisationError,
		{
			topics: [config.kafka.topics.main],
			mode: config.kafka.readMode,
			maxWaitTime: config.kafka.maxWaitTime,
			fetchMaxBytes: config.kafka.fetchMaxBytes,
			batchSize: config.kafka.batchSize,
			lingerMs: config.kafka.lingerMs
		}
	);
} catch (error) {
	logger.error({ err: error }, "Consumer stopped on an unrecoverable error");
	await shutDownGracefully(resources, 1);
}
// #endregion
