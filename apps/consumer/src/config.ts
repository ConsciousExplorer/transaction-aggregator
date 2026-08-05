import { SASLMechanisms } from "@platformatic/kafka";
import { z } from "zod";
import { LOG_LEVELS } from "./logger.ts";

const configSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		APP_NAME: z.string().default("transaction-aggregator"),
		HOST: z.string().default("0.0.0.0"),
		PORT: z.coerce.number().int().positive().default(6000),

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
		DATABASE_PASSWORD: z.string(),
		DATABASE_SSL: z.stringbool().default(false),
		DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(3),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),

		SCHEMA_REGISTRY_URL: z.url().default("http://localhost:8081"),

		KAFKA_BROKERS: z.string(),
		KAFKA_USERNAME: z.string(),
		KAFKA_PASSWORD: z.string(),
		KAFKA_SASL_MECHANISM: z.enum(SASLMechanisms).default("SCRAM-SHA-512"),
		KAFKA_GROUP_ID: z.string().default("transaction-aggregator-group"),
		KAFKA_TOPICS: z.string().default("transactions.card")
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
				password: e.DATABASE_PASSWORD,
				ssl: e.DATABASE_SSL,
				min: e.DATABASE_POOL_MIN,
				max: e.DATABASE_POOL_MAX
			}),
			kafka: Object.freeze({
				brokers: e.KAFKA_BROKERS,
				groupId: e.KAFKA_GROUP_ID,
				clientId: e.APP_NAME,
				sasl: Object.freeze({
					mechanism: e.KAFKA_SASL_MECHANISM,
					username: e.KAFKA_USERNAME,
					password: e.KAFKA_PASSWORD
				}),
				topics: Object.freeze({
					card: e.KAFKA_TOPICS
				})
			}),
			schemaRegistry: { url: e.SCHEMA_REGISTRY_URL }
		})
	);

export function loadConfig(
	env: Record<string, string | undefined>
): z.infer<typeof configSchema> {
	const result = configSchema.safeParse(env);
	if (!result.success) {
		const detail = result.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid configuration:\n${detail}`);
	}
	return result.data;
}

export type ConfigSchema = z.infer<typeof configSchema>;
