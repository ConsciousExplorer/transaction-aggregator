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

		RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100) // per client, per minute
	})
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
				max: e.DATABASE_POOL_MAX
			}),
			auth: Object.freeze({
				jwksUri: e.AUTH_JWKS_URI,
				issuer: e.AUTH_ISSUER,
				audience: e.AUTH_AUDIENCE
			}),
			rateLimit: Object.freeze({ max: e.RATE_LIMIT_MAX }),
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
