import type { Server } from "node:http";
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import { createFileLogger } from "#src/logger.ts";
import { config, secrets } from "#src/runtime.ts";
import { createDatabase, createPool } from "./integrations/database/pool.ts";
import { loadRuleset } from "./integrations/database/repositories/rule-repository.ts";
import {
	createAvroDeserialiser,
	createMissingSchemaLoader,
	loadSubjectSchemas
} from "./integrations/events/avro-deserialiser.ts";
import { handleDeserialisationError } from "./integrations/events/handlers/handleDeserialisationError.ts";
import { createTransactionBatchHandler } from "./integrations/events/handlers/transactionBatchHandler.ts";
import {
	createDeadLetterSender,
	createKafkaConsumer,
	createKafkaDeadLetterProducer,
	type DeadLetterProducer,
	type KafkaConsumer,
	listenForConsumerErrors,
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

/**
 * Runs one step of the shutdown. A step that fails is logged and the steps
 * after it still run, so one resource that won't close can't keep the others
 * open.
 */
async function runShutdownStep(name: string, action: () => unknown) {
	try {
		await action();
	} catch (error) {
		logger.error({ err: error }, `${name} failed`);
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
	await runShutdownStep("Consumer close", () =>
		resources.kafkaConsumer.close(true)
	);
	await runShutdownStep("Pool close", () => resources.writerPool.end());
	await runShutdownStep("Producer close", () =>
		resources.deadLetterProducer.close()
	);
	await runShutdownStep("Health server close", () => resources.server.close());
	await runShutdownStep("Trace flush", () => tracerProvider?.forceFlush());

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
	loadRuleset(createDatabase(writerPool), config.rulesetVersion)
);

// The schemas registered so far. The deserialiser reads this map and the
// loader adds to it when a producer starts writing a newer version.
const schemaTypes = await runStartupCheck("SchemaRegistry", () =>
	loadSubjectSchemas(
		config.schemaRegistry.url,
		`${config.kafka.topics.main}-value`
	)
);

const deserialiseValue =
	createAvroDeserialiser<DomainTransactionSchema>(schemaTypes);

const loadMissingSchema = createMissingSchemaLoader(
	config.schemaRegistry.url,
	schemaTypes
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
listenForConsumerErrors(kafkaConsumer, () => shutDownGracefully(resources, 1));
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
	 * Feeds the kafka_consumers_lags metric. The consumer's lag is the
	 * difference between the last offset in the partition and the last offset
	 * the consumer has committed.
	 */
	kafkaConsumer.startLagMonitoring(
		{ topics: [config.kafka.topics.main] },
		config.kafka.lagMonitoringInterval
	);

	await startBatchConsumer(
		kafkaConsumer,
		handleTransactionBatch,
		handleDeserialisationError,
		loadMissingSchema,
		{
			topics: [config.kafka.topics.main],
			mode: config.kafka.readMode,
			maxWaitTime: config.kafka.maxWaitTime,
			fetchMinBytes: config.kafka.fetchMinBytes,
			fetchMaxBytes: config.kafka.fetchMaxBytes,
			batchSize: config.kafka.batchSize
		}
	);
} catch (error) {
	logger.error({ err: error }, "Consumer stopped on an unrecoverable error");
	await shutDownGracefully(resources, 1);
}
// #endregion
