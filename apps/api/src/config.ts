import z from "zod";
import { LOG_LEVELS } from "./logger.ts";

const appInfoSchema = z.object({
	name: z.string(),
	version: z.string(),
	description: z.string(),
	author: z.string()
});

function separateByDelimiter(value: string, delimiter: string) {
	const entries: string[] = [];
	for (const entry of value.split(delimiter)) {
		const trimmed = entry.trim();
		if (trimmed !== "") {
			entries.push(trimmed);
		}
	}
	return entries;
}

const configSchema = z
	.object({
		HOST: z.string().default("0.0.0.0"),
		HTTP_PORT: z.coerce.number().int().positive().default(3000),
		SECRET_DIR: z.string().default("/secrets"),

		ENABLE_SWAGGER: z.stringbool().default(false),

		LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
		// Comma-separated field names redacted on top of the card number fields
		LOG_REDACTED_FIELDS: z
			.string()
			.default("")
			.transform((value) => separateByDelimiter(value, ",")),
		LOG_REDACT_DEPTH: z.coerce.number().int().positive().default(3),

		DATABASE_HOST: z.string().default("localhost"),
		DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		DATABASE_NAME: z.string().default("txn_agg"),
		DATABASE_USER: z.string().default("api_write"),
		DATABASE_PASSWORD_SECRET_NAME: z.string().default("super_secret"),
		DATABASE_POOL_MIN: z.coerce.number().int().positive().default(3),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
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
		// The server cancels a statement that runs or waits on a lock too long. A
		// connection whose server is gone without a reset never answers, so that
		// cancel never arrives either; the query timeout runs in the client and
		// fails the query a second later.
		DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(5_000),
		DATABASE_QUERY_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(6_000),
		// How long a connection sits idle before TCP keep-alive probes it, so a
		// dead one is dropped from the pool instead of being handed to the next
		// request
		DATABASE_KEEP_ALIVE_DELAY_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(10_000),
		// Either one logs every statement drizzle sends. _SQL fills its values in;
		// _PLAN adds its plan (EXPLAIN ANALYZE re-runs every read).
		DATABASE_QUERY_LOG_SQL: z.stringbool().default(false),
		DATABASE_QUERY_LOG_PLAN: z.stringbool().default(false),

		AUTH_JWKS_URI: z
			.url()
			.default(
				"http://keycloak:8086/realms/txn-api/protocol/openid-connect/certs"
			),
		AUTH_ISSUER: z.url().default("http://keycloak:8086/realms/txn-api"),
		AUTH_AUDIENCE: z.string().default("txn-api"),

		// Widest fromDateTime → toDateTime span the list and summary accept. Any
		// twelve calendar months fit in 366 days.
		WINDOW_MAX_DAYS: z.coerce.number().int().positive().default(366)
	})
	.transform((environment) =>
		Object.freeze({
			app: Object.freeze({
				host: environment.HOST,
				port: environment.HTTP_PORT
			}),
			api: Object.freeze({
				enableSwagger: environment.ENABLE_SWAGGER
			}),
			logging: Object.freeze({
				level: environment.LOG_LEVEL,
				redactedFields: environment.LOG_REDACTED_FIELDS,
				redactDepth: environment.LOG_REDACT_DEPTH
			}),
			database: Object.freeze({
				host: environment.DATABASE_HOST,
				port: environment.DATABASE_PORT,
				database: environment.DATABASE_NAME,
				user: environment.DATABASE_USER,
				min: environment.DATABASE_POOL_MIN,
				max: environment.DATABASE_POOL_MAX,
				idleTimeout: environment.DATABASE_IDLE_TIMEOUT_MS,
				connectionTimeout: environment.DATABASE_CONNECTION_TIMEOUT_MS,
				statementTimeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
				queryTimeout: environment.DATABASE_QUERY_TIMEOUT_MS,
				keepAliveDelay: environment.DATABASE_KEEP_ALIVE_DELAY_MS,
				queryLog: Object.freeze({
					sql: environment.DATABASE_QUERY_LOG_SQL,
					plan: environment.DATABASE_QUERY_LOG_PLAN
				})
			}),
			auth: Object.freeze({
				jwksUri: environment.AUTH_JWKS_URI,
				issuer: environment.AUTH_ISSUER,
				audience: environment.AUTH_AUDIENCE
			}),
			queryWindow: Object.freeze({
				maxDays: environment.WINDOW_MAX_DAYS
			}),
			secretsSpec: Object.freeze({
				dir: environment.SECRET_DIR,
				secrets: Object.freeze({
					databasePassword: environment.DATABASE_PASSWORD_SECRET_NAME
				})
			})
		})
	);

export type Config = z.infer<typeof configSchema>;
export type AppInfoConfig = z.infer<typeof appInfoSchema>;
export type QueryWindowConfig = Config["queryWindow"];

/** One line per issue, so startup fails naming every bad setting at once */
function invalidConfigurationError(error: z.ZodError) {
	const issueLines: string[] = [];
	for (const issue of error.issues) {
		issueLines.push(`  ${issue.path.join(".")}: ${issue.message}`);
	}
	return new Error(`Invalid configuration:\n${issueLines.join("\n")}`);
}

export function loadPackageInfo(packageJson: unknown) {
	const config = appInfoSchema.safeParse(packageJson);
	if (!config.success) throw invalidConfigurationError(config.error);
	return config.data;
}

export function loadConfig(env: Record<string, string | undefined>) {
	const config = configSchema.safeParse(env);
	if (!config.success) throw invalidConfigurationError(config.error);
	return config.data;
}
