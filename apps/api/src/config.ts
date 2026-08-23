import { readFileSync } from "node:fs";
import { join } from "node:path";
import z from "zod";
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
		LOG_REDACT_DEPTH: z.coerce.number().int().positive().default(3)
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
