import z from "zod";
import { LOG_LEVELS } from "./logger.ts";

const appInfoSchema = z.object({
	name: z.string(),
	version: z.string(),
	description: z.string(),
	author: z.string()
});

const configSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		HOST: z.string().default("0.0.0.0"),
		HTTP_PORT: z.coerce.number().int().positive().default(3000),
		SECRET_DIR: z.string().default("/secrets"),

		ENABLE_SWAGGER: z.stringbool().default(false),

		LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
		LOG_FORMAT: z.enum(["json", "text"]).default("json"),
		LOG_PRETTY: z.stringbool().default(false),

		DATABASE_HOST: z.string().default("localhost"),
		DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		DATABASE_NAME: z.string().default("txn_agg"),
		DATABASE_USER: z.string().default("api_write"),
		DATABASE_PASSWORD_SECRET_NAME: z.string().default("super_secret"),
		DATABASE_POOL_MIN: z.coerce.number().int().positive().default(3),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
		// Development only. sql logs each statement with its values filled in;
		// plan also logs its plan (EXPLAIN ANALYZE re-runs every read)
		DATABASE_QUERY_LOG: z.enum(["off", "sql", "plan"]).default("off"),

		AUTH_JWKS_URI: z
			.url()
			.optional()
			.default(
				"http://keycloak:8086/realms/txn-api/protocol/openid-connect/certs"
			),
		AUTH_ISSUER: z
			.url()
			.optional()
			.default("http://keycloak:8086/realms/txn-api"),
		AUTH_AUDIENCE: z.string().optional().default("txn-api"),

		// Widest fromDateTime → toDateTime span the list and summary accept. Any
		// twelve calendar months fit in 366 days.
		WINDOW_MAX_DAYS: z.coerce.number().int().positive().default(366)
	})
	.refine(
		(e) => e.DATABASE_QUERY_LOG === "off" || e.NODE_ENV === "development",
		{
			message: "query logging is for NODE_ENV=development only",
			path: ["DATABASE_QUERY_LOG"]
		}
	)
	.transform((e) =>
		Object.freeze({
			app: Object.freeze({
				env: e.NODE_ENV,
				host: e.HOST,
				port: e.HTTP_PORT
			}),
			api: Object.freeze({
				enableSwagger: e.ENABLE_SWAGGER
			}),
			logging: Object.freeze({
				level: e.LOG_LEVEL,
				format: e.LOG_FORMAT,
				pretty: e.LOG_PRETTY
			}),
			database: Object.freeze({
				host: e.DATABASE_HOST,
				port: e.DATABASE_PORT,
				database: e.DATABASE_NAME,
				user: e.DATABASE_USER,
				min: e.DATABASE_POOL_MIN,
				max: e.DATABASE_POOL_MAX,
				queryLog: e.DATABASE_QUERY_LOG
			}),
			auth: Object.freeze({
				jwksUri: e.AUTH_JWKS_URI,
				issuer: e.AUTH_ISSUER,
				audience: e.AUTH_AUDIENCE
			}),
			queryWindow: Object.freeze({
				maxDays: e.WINDOW_MAX_DAYS
			}),
			secretsSpec: Object.freeze({
				dir: e.SECRET_DIR,
				secrets: Object.freeze({
					databasePassword: e.DATABASE_PASSWORD_SECRET_NAME
				})
			})
		})
	);

export type Config = z.infer<typeof configSchema>;
export type AppInfoConfig = z.infer<typeof appInfoSchema>;
export type QueryWindowConfig = Config["queryWindow"];

export function loadPackageInfo(pkg: unknown): AppInfoConfig {
	const config = appInfoSchema.safeParse(pkg);

	if (!config.success) {
		const detail = config.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid configuration:\n${detail}`);
	}

	return config.data;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
	const config = configSchema.safeParse(env);

	if (!config.success) {
		const detail = config.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(`Invalid configuration:\n${detail}`);
	}

	return config.data;
}
