import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SASLMechanisms } from "@platformatic/kafka";
import { z } from "zod";
import { LOG_LEVELS } from "./logger.ts";

const csv = (value: string) =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

const configSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		APP_NAME: z.string().default("transaction-aggregator"),
		HOST: z.string().default("0.0.0.0"),
		PORT: z.coerce.number().int().positive().default(6000),
		SECRET_DIR: z.string().default("/secrets"),

		LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
		LOG_FORMAT: z.enum(["json", "text"]).default("json"),
		LOG_PRETTY: z.stringbool().default(false),
		LOG_REDACTED_FIELDS: z
			.string()
			.default("")
			.transform((field) =>
				field
					.split(",")
					.map((f) => f.trim())
					.filter(Boolean)
			),
		LOG_REDACT_DEPTH: z.coerce.number().int().positive().default(3),

		DATABASE_HOST: z.string().default("localhost"),
		DATABASE_NAME: z.string().default("txn_agg"),
		DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		DATABASE_USER: z.string(),
		DATABASE_PASSWORD_SECRET_NAME: z.string(),
		DATABASE_SSL: z.stringbool().default(false),
		DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(3),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),

		SCHEMA_REGISTRY_URL: z.url().default("http://localhost:8081"),

		KAFKA_BROKERS: z.string().transform(csv),
		KAFKA_USERNAME: z.string(),
		KAFKA_PASSWORD_SECRET_NAME: z.string(),
		KAFKA_SASL_MECHANISM: z.enum(SASLMechanisms).default("SCRAM-SHA-512"),
		KAFKA_GROUP_ID: z.string().default("transaction-aggregator-group"),
		KAFKA_TOPIC: z.string().default("transactions.card"),
		KAFKA_DLQ_TOPIC: z.string().default("transactions.card.dlq"), // TODO: define more dlq topics

		KAFKA_SESSION_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(15_000),
		KAFKA_HEARTBEAT_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(5_000),
		KAFKA_REBALANCE_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(30_000),
		KAFKA_REQUEST_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(40_000),

		// Fetch and batching.
		KAFKA_MAX_WAIT_TIME_MS: z.coerce.number().int().positive().default(1_000),
		KAFKA_BATCH_SIZE: z.coerce.number().int().positive().default(100),
		KAFKA_BATCH_LINGER_MS: z.coerce.number().int().positive().default(2_000),
		KAFKA_READ_MODE: z
			.enum(["earliest", "latest", "committed"])
			.default("committed"),

		// Retry policy for retryable (infrastructure) batch failures.
		KAFKA_MAX_RETRIES: z.coerce.number().int().min(0).default(5),
		KAFKA_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(500)
	})
	.superRefine((e, ctx) => {
		if (e.KAFKA_HEARTBEAT_INTERVAL_MS > e.KAFKA_SESSION_TIMEOUT_MS / 3) {
			ctx.addIssue({
				code: "custom",
				path: ["KAFKA_HEARTBEAT_INTERVAL_MS"],
				message: `must be at most a third of KAFKA_SESSION_TIMEOUT_MS (${e.KAFKA_SESSION_TIMEOUT_MS})`
			});
		}

		if (e.KAFKA_REBALANCE_TIMEOUT_MS < e.KAFKA_SESSION_TIMEOUT_MS) {
			ctx.addIssue({
				code: "custom",
				path: ["KAFKA_REBALANCE_TIMEOUT_MS"],
				message: `must be at least KAFKA_SESSION_TIMEOUT_MS (${e.KAFKA_SESSION_TIMEOUT_MS})`
			});
		}

		if (e.KAFKA_REQUEST_TIMEOUT_MS <= e.KAFKA_REBALANCE_TIMEOUT_MS) {
			ctx.addIssue({
				code: "custom",
				path: ["KAFKA_REQUEST_TIMEOUT_MS"],
				message: `must exceed KAFKA_REBALANCE_TIMEOUT_MS (${e.KAFKA_REBALANCE_TIMEOUT_MS}) or JoinGroup times out mid-rebalance`
			});
		}
	})
	.transform((e) =>
		Object.freeze({
			app: Object.freeze({
				env: e.NODE_ENV,
				name: e.APP_NAME,
				host: e.HOST,
				port: e.PORT,
				isProduction: e.NODE_ENV === "production"
			}),
			logging: Object.freeze({
				level: e.LOG_LEVEL,
				format: e.LOG_FORMAT,
				pretty: e.LOG_PRETTY,
				redactedFields: e.LOG_REDACTED_FIELDS,
				redactDepth: e.LOG_REDACT_DEPTH
			}),
			database: Object.freeze({
				host: e.DATABASE_HOST,
				port: e.DATABASE_PORT,
				database: e.DATABASE_NAME,
				user: e.DATABASE_USER,
				ssl: e.DATABASE_SSL,
				min: e.DATABASE_POOL_MIN,
				max: e.DATABASE_POOL_MAX
			}),
			kafka: Object.freeze({
				brokers: e.KAFKA_BROKERS, // string[] now
				groupId: e.KAFKA_GROUP_ID,
				clientId: e.APP_NAME,
				sasl: Object.freeze({
					mechanism: e.KAFKA_SASL_MECHANISM,
					username: e.KAFKA_USERNAME
				}),
				topics: Object.freeze({
					main: e.KAFKA_TOPIC, // string[] now
					dlq: e.KAFKA_DLQ_TOPIC
				}),
				sessionTimeout: e.KAFKA_SESSION_TIMEOUT_MS,
				heartbeatInterval: e.KAFKA_HEARTBEAT_INTERVAL_MS,
				rebalanceTimeout: e.KAFKA_REBALANCE_TIMEOUT_MS,
				requestTimeout: e.KAFKA_REQUEST_TIMEOUT_MS,
				maxWaitTime: e.KAFKA_MAX_WAIT_TIME_MS,
				batchSize: e.KAFKA_BATCH_SIZE,
				lingerMs: e.KAFKA_BATCH_LINGER_MS,
				readMode: e.KAFKA_READ_MODE,
				maxRetries: e.KAFKA_MAX_RETRIES,
				retryBaseDelayMs: e.KAFKA_RETRY_BASE_DELAY_MS
			}),
			schemaRegistry: { url: e.SCHEMA_REGISTRY_URL },

			// Keeping secrets separate to ensure they are not logged out by mistake
			secrets: Object.freeze({
				database_password: readSecretFromFile(
					e.SECRET_DIR,
					e.DATABASE_PASSWORD_SECRET_NAME
				),
				kafka_password: readSecretFromFile(
					e.SECRET_DIR,
					e.KAFKA_PASSWORD_SECRET_NAME
				)
			})
		})
	);

export function readSecretFromFile(dir: string, fileName: string): string {
	const path = join(dir, fileName);

	try {
		return readFileSync(path, "utf-8").trim();
	} catch (error) {
		throw new Error(`Unable to read secret "${fileName}" from ${path}`, {
			cause: error
		});
	}
}

export type ConfigSchema = z.infer<typeof configSchema>;

export function loadConfig(
	env: Record<string, string | undefined>
): ConfigSchema {
	const config = configSchema.safeParse(env);

	if (!config.success) {
		const detail = config.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid configuration:\n${detail}`);
	}

	return config.data;
}
