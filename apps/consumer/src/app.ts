/**
 * App main entrypoint
 */

import type { Server } from "node:http";
import process from "node:process";
import { stringDeserializer } from "@platformatic/kafka";
import type { Pool } from "pg";
import {
	createRuleCategoriser,
	type Rule,
	type RuleCategoriser,
	type RuleSet
} from "./domain/categorisation/rule-categoriser.ts";
import {
	createNormaliser,
	type Normaliser
} from "./domain/normaliser/normaliser.ts";
import { deserialisationErrorHandler } from "./handlers/deserialiserErrorHandler.ts";
import { transactionBatchHandler } from "./handlers/transactionHandler.ts";
import { createPool } from "./integrations/database/pool.ts";
import {
	loadActiveRules,
	loadUncategorisedId
} from "./integrations/database/repositories/rule-repository.ts";
import { createAvroDeserializer } from "./integrations/events/avro-deserializer.ts";
import {
	type ConsumedTransaction,
	type ConsumedValue,
	createKafkaConsumer,
	createKafkaDlqProducer,
	type DlqProducer,
	type KafkaConsumer,
	startBatchConsumer
} from "./integrations/events/kafka.ts";
import { createServer } from "./integrations/http/server.ts";
import { config, fileLogger } from "./runtime.ts";

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
			password: config.secrets.database_password
		});

		// Force a real connection and release client directly
		await pool.query("SELECT 1");

		return pool;
	});

	rules = await loadActiveRules(writerPool);
	uncategorisedId = await loadUncategorisedId(writerPool);

	const avroDeserializer = await startupCheck("SchemaRegistry", () =>
		createAvroDeserializer<ConsumedTransaction>(config.schemaRegistry.url, [
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

	const ruleset = {
		version: 1,
		rules: rules,
		uncategorisedId: uncategorisedId
	} as RuleSet;

	transactionNormaliser = createNormaliser(config.source);
	ruleCategoriser = createRuleCategoriser(ruleset);

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
		kafkaDlqProducer,
		config.kafka.topics.dlq,
		writerPool,
		transactionNormaliser,
		ruleCategoriser,
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
