import {
	type MessagesStreamModeValue,
	SASLMechanisms
} from "@platformatic/kafka";
import { z } from "zod";
import { LOG_LEVELS } from "./logger.ts";
import { CANONICAL_TRANSACTION_TYPES } from "./schemas/transaction.ts";
import { separateByDelimiter } from "./utils/separate-by-delimiter.ts";

const KAFKA_READ_MODES = [
	"earliest",
	"latest",
	"committed"
] as const satisfies readonly MessagesStreamModeValue[];

const configSchema = z
	.object({
		APP_NAME: z.string().default("transaction-aggregator"),
		HOST: z.string().default("0.0.0.0"),
		PORT: z.coerce.number().int().positive().default(6000),
		SECRET_DIR: z.string().default("/secrets"),

		// Validated here so a bad value fails startup, but not read from config:
		// every module creates its logger at import, before config loads, so
		// logger.ts reads these from the environment itself.
		LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
		// Comma-separated field names redacted on top of the card number fields
		LOG_REDACTED_FIELDS: z.string().default(""),
		LOG_REDACT_DEPTH: z.coerce.number().int().positive().default(3),

		DATABASE_HOST: z.string().default("localhost"),
		DATABASE_NAME: z.string().default("txn_agg"),
		DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		DATABASE_USER: z.string(),
		DATABASE_PASSWORD_SECRET_NAME: z.string(),
		DATABASE_SSL: z.stringbool().default(false),
		DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(3),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
		DATABASE_IDLE_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(30_000),
		DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),
		// Without the statement and query timeouts an INSERT that never gets an
		// answer waits forever: the flush never ends, the loop pulls nothing more,
		// and the heartbeats keep the partitions. Either one fails the batch as
		// retryable instead, so the process exits uncommitted and the restart
		// reads the batch again. The statement timeout runs on the server and
		// fires first, so a lock wait fails as 57014. The query timeout runs in
		// the client, for a connection whose server is gone without a reset.
		DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(25_000),
		DATABASE_QUERY_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(30_000),
		// How long a connection sits idle before TCP keep-alive probes it, so a
		// dead one is dropped from the pool instead of being handed to the next batch
		DATABASE_KEEP_ALIVE_DELAY_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),

		SCHEMA_REGISTRY_URL: z.url().default("http://localhost:8081"),

		// One consumer instance per transaction type: selects the normaliser,
		// the canonical/DB type value, and the consumer group id.
		TRANSACTION_TYPE: z.enum(CANONICAL_TRANSACTION_TYPES).default("card"),

		KAFKA_BROKERS: z
			.string()
			.transform((value) => separateByDelimiter(value, ",")),
		// Topic names are explicit config, exactly as the producers take them —
		// broker topics are dashed (transactions.debit-order) while the
		// canonical type keeps its underscore. The DLQ topic is <topic>.dlq.
		KAFKA_TOPIC: z.string().min(1),
		KAFKA_USERNAME: z.string(),
		KAFKA_PASSWORD_SECRET_NAME: z.string(),
		KAFKA_SASL_MECHANISM: z.enum(SASLMechanisms).default("SCRAM-SHA-512"),

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
		// The most one fetch returns (Kafka's fetch.max.bytes). The client pushes
		// a whole fetch into its buffer before backpressure applies, so this is
		// what bounds memory under a backlog. At the client's 50 MB default, one
		// fetch held about 144,000 card records and the consumer was OOM-killed;
		// 1 MiB holds a few thousand and reads just as fast.
		KAFKA_FETCH_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(1_048_576),
		KAFKA_BATCH_SIZE: z.coerce.number().int().positive().default(100),
		KAFKA_BATCH_LINGER_MS: z.coerce.number().int().positive().default(2_000),
		KAFKA_READ_MODE: z.enum(KAFKA_READ_MODES).default("committed"),

		// How often the client measures lag for kafka_consumers_lags. Match the
		// Prometheus scrape_interval: refreshing faster is wasted work.
		KAFKA_LAG_MONITORING_INTERVAL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),

		// Tracing is off unless the obs profile sets OTEL_SDK_DISABLED=false.
		OTEL_SDK_DISABLED: z.stringbool().default(true),
		OTEL_SERVICE_NAME: z.string().default("consumer")
	})
	.superRefine((environment, context) => {
		if (
			environment.KAFKA_HEARTBEAT_INTERVAL_MS >
			environment.KAFKA_SESSION_TIMEOUT_MS / 3
		) {
			context.addIssue({
				code: "custom",
				path: ["KAFKA_HEARTBEAT_INTERVAL_MS"],
				message: `must be at most a third of KAFKA_SESSION_TIMEOUT_MS (${environment.KAFKA_SESSION_TIMEOUT_MS})`
			});
		}

		if (
			environment.KAFKA_REBALANCE_TIMEOUT_MS <
			environment.KAFKA_SESSION_TIMEOUT_MS
		) {
			context.addIssue({
				code: "custom",
				path: ["KAFKA_REBALANCE_TIMEOUT_MS"],
				message: `must be at least KAFKA_SESSION_TIMEOUT_MS (${environment.KAFKA_SESSION_TIMEOUT_MS})`
			});
		}

		if (
			environment.KAFKA_REQUEST_TIMEOUT_MS <=
			environment.KAFKA_REBALANCE_TIMEOUT_MS
		) {
			context.addIssue({
				code: "custom",
				path: ["KAFKA_REQUEST_TIMEOUT_MS"],
				message: `must exceed KAFKA_REBALANCE_TIMEOUT_MS (${environment.KAFKA_REBALANCE_TIMEOUT_MS}) or JoinGroup times out mid-rebalance`
			});
		}
	})
	.transform((environment) =>
		Object.freeze({
			app: Object.freeze({
				host: environment.HOST,
				port: environment.PORT
			}),
			database: Object.freeze({
				host: environment.DATABASE_HOST,
				port: environment.DATABASE_PORT,
				database: environment.DATABASE_NAME,
				user: environment.DATABASE_USER,
				ssl: environment.DATABASE_SSL,
				min: environment.DATABASE_POOL_MIN,
				max: environment.DATABASE_POOL_MAX,
				idleTimeout: environment.DATABASE_IDLE_TIMEOUT_MS,
				connectionTimeout: environment.DATABASE_CONNECTION_TIMEOUT_MS,
				statementTimeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
				queryTimeout: environment.DATABASE_QUERY_TIMEOUT_MS,
				keepAliveDelay: environment.DATABASE_KEEP_ALIVE_DELAY_MS
			}),
			transactionType: environment.TRANSACTION_TYPE,
			kafka: Object.freeze({
				brokers: environment.KAFKA_BROKERS, // string[] now
				groupId: `transaction-consumer-${environment.TRANSACTION_TYPE}`,
				clientId: environment.APP_NAME,
				sasl: Object.freeze({
					mechanism: environment.KAFKA_SASL_MECHANISM,
					username: environment.KAFKA_USERNAME
				}),
				topics: Object.freeze({
					main: environment.KAFKA_TOPIC,
					deadLetter: `${environment.KAFKA_TOPIC}.dlq`
				}),
				sessionTimeout: environment.KAFKA_SESSION_TIMEOUT_MS,
				heartbeatInterval: environment.KAFKA_HEARTBEAT_INTERVAL_MS,
				rebalanceTimeout: environment.KAFKA_REBALANCE_TIMEOUT_MS,
				requestTimeout: environment.KAFKA_REQUEST_TIMEOUT_MS,
				maxWaitTime: environment.KAFKA_MAX_WAIT_TIME_MS,
				fetchMaxBytes: environment.KAFKA_FETCH_MAX_BYTES,
				batchSize: environment.KAFKA_BATCH_SIZE,
				lingerMs: environment.KAFKA_BATCH_LINGER_MS,
				readMode: environment.KAFKA_READ_MODE,
				lagMonitoringInterval: environment.KAFKA_LAG_MONITORING_INTERVAL_MS
			}),
			schemaRegistry: { url: environment.SCHEMA_REGISTRY_URL },
			tracing: Object.freeze({
				enabled: !environment.OTEL_SDK_DISABLED,
				serviceName: environment.OTEL_SERVICE_NAME
			}),

			// Keeping secrets separate to ensure they are not logged out by mistake
			secretsSpec: Object.freeze({
				dir: environment.SECRET_DIR,
				secrets: Object.freeze({
					databasePassword: environment.DATABASE_PASSWORD_SECRET_NAME,
					kafkaPassword: environment.KAFKA_PASSWORD_SECRET_NAME
				})
			})
		})
	);

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>) {
	const config = configSchema.safeParse(env);

	if (!config.success) {
		const issueLines: string[] = [];
		for (const issue of config.error.issues) {
			issueLines.push(`  ${issue.path.join(".")}: ${issue.message}`);
		}
		throw new Error(`Invalid configuration:\n${issueLines.join("\n")}`);
	}

	return config.data;
}
