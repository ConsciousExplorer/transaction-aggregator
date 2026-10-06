import type { Server } from "node:http";
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import { createFileLogger } from "#src/logger.ts";
import { config, secrets } from "#src/runtime.ts";
import {
	createDatabase,
	createPool,
	type Database
} from "./integrations/database/pool.ts";
import {
	loadActiveRules,
	loadRulesetVersion,
	loadUncategorisedId
} from "./integrations/database/repositories/rule-repository.ts";
import {
	createAvroDeserialiser,
	type FetchOnMiss
} from "./integrations/events/avro-deserialiser.ts";
import { handleDeserialisationError } from "./integrations/events/handlers/handleDeserialisationError.ts";
import {
	type BatchHandler,
	createTransactionBatchHandler,
	type SendToDlq
} from "./integrations/events/handlers/transactionBatchHandler.ts";
import {
	type ConsumedValue,
	createDlqSender,
	createKafkaConsumer,
	createKafkaDlqProducer,
	type DlqProducer,
	type KafkaConsumer,
	startBatchConsumer
} from "./integrations/events/kafka.ts";
import { createServer } from "./integrations/http/server.ts";
import type { DomainTransactionSchema } from "./schemas/transaction.ts";
import {
	createNormaliser,
	type Normaliser
} from "./services/domain-normaliser.ts";
import {
	createRuleCategoriser,
	type Rule,
	type RuleCategoriser,
	type RuleSet
} from "./services/rule-categoriser.ts";
import { createTransactionIngester } from "./services/transaction-ingester.ts";
import { registry } from "./telemetry/metrics.ts";
import { startTracing } from "./telemetry/tracing.ts";

const logger = createFileLogger(import.meta.url);

// Undefined when tracing is disabled
const tracerProvider = startTracing(config.tracing);

// Dependencies
let writerPool: Pool;
let writerDb: Database;
let kafkaConsumer: KafkaConsumer;
let kafkaDlqProducer: DlqProducer;
let server: Server;
let rules: Rule[];
let rulesetVersion: number;
let uncategorisedId: number;
let transactionNormaliser: Normaliser;
let ruleCategoriser: RuleCategoriser;
let sendToDlq: SendToDlq;
let transactionBatchHandler: BatchHandler;
let fetchOnMiss: FetchOnMiss;

export async function runStartupCheck<T>(
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

export async function shutDownGracefully(code = 0): Promise<never> {
	// Consumer first. force closes the open message stream, which close()
	// otherwise refuses to leave the group over; LeaveGroup is what stops the
	// next start from waiting out the session timeout on a zombie member. A
	// batch cut off here was never committed and is read again after restart.
	try {
		await kafkaConsumer.close(true);
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

	try {
		server.close();
	} catch (err) {
		logger.error({ err }, "Health server close failed");
	}

	try {
		await tracerProvider?.forceFlush();
	} catch (err) {
		logger.error({ err }, "Trace flush failed");
	}

	process.exit(code);
}

// #region: Kill Processes
process.on("SIGTERM", () => void shutDownGracefully());
process.on("SIGINT", () => void shutDownGracefully());
// #endregion

// #region: Main entrypoint
try {
	// Create database pool to manage connections
	writerPool = await runStartupCheck("PostgreSQL", async () => {
		const pool = await createPool({
			min: config.database.min,
			max: config.database.max,
			database: config.database.database,
			host: config.database.host,
			port: config.database.port,
			user: config.database.user,
			password: secrets.databasePassword
		});

		/** Force a real connection and release client directly */
		await pool.query("SELECT 1");

		return pool;
	});

	writerDb = createDatabase(writerPool);

	rules = await loadActiveRules(writerDb);
	rulesetVersion = await loadRulesetVersion(writerDb);
	uncategorisedId = await loadUncategorisedId(writerDb);

	const avroDeserialiser = await runStartupCheck("SchemaRegistry", () =>
		createAvroDeserialiser<DomainTransactionSchema>(config.schemaRegistry.url, [
			`${config.kafka.topics.main}-value`
		])
	);
	fetchOnMiss = avroDeserialiser.fetchOnMiss; //TODO: might need to remove this.


	/** 
	 * Create the Kafka consumer instance.
	 */
	kafkaConsumer = await createKafkaConsumer<
		string,
		ConsumedValue,
		string,
		string
	>(
		{
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
				password: secrets.kafkaPassword
			},
			deserializers: {
				key: stringDeserializer,
				value: avroDeserialiser.deserialise,
				headerKey: stringDeserializer,
				headerValue: stringDeserializer
			}
		},
		registry
	);

	kafkaDlqProducer = await createKafkaDlqProducer(
		{
			clientId: `${config.kafka.clientId}_producer`,
			acks: -1,
			bootstrapBrokers: config.kafka.brokers,
			sasl: {
				mechanism: config.kafka.sasl.mechanism,
				username: config.kafka.sasl.username,
				password: secrets.kafkaPassword
			}
		},
		registry
	);

	const ruleset: RuleSet = {
		version: rulesetVersion,
		rules: rules,
		uncategorisedId: uncategorisedId
	};

	transactionNormaliser = createNormaliser(config.transactionType);
	ruleCategoriser = createRuleCategoriser(ruleset);

	const transactionIngester = createTransactionIngester(
		transactionNormaliser,
		ruleCategoriser,
		writerPool
	);

	sendToDlq = createDlqSender(kafkaDlqProducer, config.kafka.topics.dlq);
	transactionBatchHandler = createTransactionBatchHandler(
		transactionIngester,
		sendToDlq
	);

	/**
	 * Connects and authenticates both clients, the broker's SELECT 1. Awaited, so
	 * a broker failure lands in the catch below instead of an unhandled rejection.
	 */
	await Promise.all([
		kafkaDlqProducer.metadata({ forceUpdate: true }),
		kafkaConsumer.metadata({ forceUpdate: true })
	]);

	server = await createServer();
	server.listen(config.app.port);
} catch (err) {
	logger.error({ err }, "Startup failed");
	await shutDownGracefully(1);
	process.exit(1);
}


/**
 * The consumer closes the loop for subsequent calls. Server.listen must be called earlier
 */
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

	/**
	 * Start the main consumer loop.
	 */
	await startBatchConsumer(
		kafkaConsumer,
		transactionBatchHandler,
		handleDeserialisationError,
		{
			topics: Array(config.kafka.topics.main),
			mode: config.kafka.readMode,
			maxWaitTime: config.kafka.maxWaitTime,
			batchSize: config.kafka.batchSize,
			lingerMs: config.kafka.lingerMs
		},
		{ beforeDeserialization: fetchOnMiss }
	);
} catch (err) {
	logger.error({ err }, "Consumer stopped on an unrecoverable error");
	await shutDownGracefully(1);
}

// #endregion
