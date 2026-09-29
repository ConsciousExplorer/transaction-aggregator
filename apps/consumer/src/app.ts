// Must precede every module that creates a module logger: runtime.ts loads and
// validates config, then configures logging. Pino children copy the root when
// they are created, so a later swap cannot reach them.
import "./runtime.ts";
import type { Server } from "node:http";
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import { createPool } from "./integrations/database/pool.ts";
import {
	loadActiveRules,
	loadUncategorisedId
} from "./integrations/database/repositories/rule-repository.ts";
import { createAvroDeserializer } from "./integrations/events/avro-deserialiser.ts";
import { deserialisationErrorHandler } from "./integrations/events/handlers/deserialiserErrorHandler.ts";
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
import { fileLogger } from "./log.ts";
import { config, secrets } from "./runtime.ts";
import type { DomainTransactionSchema } from "./schemas/transaction.ts";
import {
	createNormaliser,
	type Normaliser
} from "./services/domain-normaliser.ts";
import { createTransactionIngestion } from "./services/ingestion.ts";
import {
	createRuleCategoriser,
	type Rule,
	type RuleCategoriser,
	type RuleSet
} from "./services/rule-categoriser.ts";

const logger = fileLogger(import.meta.url);

// Dependencies
let writerPool: Pool;
let kafkaConsumer: KafkaConsumer;
let kafkaDlqProducer: DlqProducer;
let server: Server;
let rules: Rule[];
let uncategorisedId: number;
let transactionNormaliser: Normaliser;
let ruleCategoriser: RuleCategoriser;
let sendToDlq: SendToDlq;
let transactionBatchHandler: BatchHandler;

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

	try {
		server.close();
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
	writerPool = await startupCheck("PostgreSQL", async () => {
		const pool = await createPool({
			min: config.database.min,
			max: config.database.max,
			database: config.database.database,
			host: config.database.host,
			port: config.database.port,
			user: config.database.user,
			password: secrets.databasePassword
		});

		// Force a real connection and release client directly
		await pool.query("SELECT 1");

		return pool;
	});

	rules = await loadActiveRules(writerPool);
	uncategorisedId = await loadUncategorisedId(writerPool);

	const avroDeserializer = await startupCheck("SchemaRegistry", () =>
		createAvroDeserializer<DomainTransactionSchema>(config.schemaRegistry.url, [
			`${config.kafka.topics.main}-value`
		])
	);

	// Explicit type arguments: `Value` must include `undefined` (tombstones),
	// but inference absorbs the deserializer's `| undefined` into the generic.
	kafkaConsumer = await createKafkaConsumer<
		string,
		ConsumedValue,
		string,
		string
	>({
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
			value: avroDeserializer,
			headerKey: stringDeserializer,
			headerValue: stringDeserializer
		}
	});

	kafkaDlqProducer = await createKafkaDlqProducer({
		clientId: `${config.kafka.clientId}_producer`,
		acks: -1,
		bootstrapBrokers: config.kafka.brokers,
		sasl: {
			mechanism: config.kafka.sasl.mechanism,
			username: config.kafka.sasl.username,
			password: secrets.kafkaPassword
		}
	});

	const ruleset = {
		version: 1,
		rules: rules,
		uncategorisedId: uncategorisedId
	} as RuleSet;

	transactionNormaliser = createNormaliser(config.transactionType);
	ruleCategoriser = createRuleCategoriser(ruleset);

	const transactionIngestion = createTransactionIngestion(
		transactionNormaliser,
		ruleCategoriser,
		writerPool
	);

	sendToDlq = createDlqSender(kafkaDlqProducer, config.kafka.topics.dlq);
	transactionBatchHandler = createTransactionBatchHandler(
		transactionIngestion,
		sendToDlq
	);

	Promise.all([
		// Connects and authenticates. Same as postgres select 1
		await kafkaDlqProducer.metadata({ forceUpdate: true }),
		await kafkaConsumer.metadata({ forceUpdate: true })
	]);

	server = await createServer();
	server.listen(config.app.port);
} catch (err) {
	logger.error({ err }, "Startup failed");
	await gracefulShutdown(1);
	process.exit(1);
}

// The consumer closes the loop for subsequent calls. Server.listen must be called earlier
try {
	logger.info(
		{ topic: config.kafka.topics.main, mode: config.kafka.readMode },
		"Starting consumer"
	);

	await startBatchConsumer(
		kafkaConsumer,
		transactionBatchHandler,
		deserialisationErrorHandler,
		{
			topics: Array(config.kafka.topics.main),
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
