import { readFileSync } from "node:fs";
import { join } from "node:path";
import z from "zod";
import data from ".././package.json" with { type: "json" };
import { LOG_LEVELS } from "./logger.ts";

const appInfo = data;

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

		DATABASE_HOST: z.string().default("localhost"),
		DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		DATABASE_NAME: z.string().default("txn_agg"),
		DATABASE_USER: z.string().default("api_write"), // SELECT-only login — proven by reader-role.test.ts
		DATABASE_PASSWORD_SECRET_NAME: z.string(),
		DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10)
	})
	.transform((e) =>
		Object.freeze({
			info: Object.freeze({
				title: appInfo.name,
				version: appInfo.version,
				description: appInfo.description,
				auhor: appInfo.author,
				dependencies: appInfo.dependencies
			}),
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
				pretty: e.LOG_PRETTY
			}),
			database: Object.freeze({
				host: e.DATABASE_HOST,
				port: e.DATABASE_PORT,
				database: e.DATABASE_NAME,
				user: e.DATABASE_USER,
				min: 3,
				max: e.DATABASE_POOL_MAX
			}),
			secrets: Object.freeze({
				database_password: readSecretFromFile(
					e.SECRET_DIR,
					e.DATABASE_PASSWORD_SECRET_NAME
				)
			})
		})
	);

export type ConfigSchema = z.infer<typeof configSchema>;

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
