import z from "zod";

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
	.transform((e) => {
		Object.freeze({
			app: Object.freeze({
				env: e.NODE_ENV,
				name: e.APP_NAME,
				host: e.HOST,
				port: e.PORT
			}),
			logging: Object.freeze({
				level: e.LOG_LEVEL,
				format: e.LOG_FORMAT,
				pretty: e.LOG_PRETTY,
				redactedFields: e.LOG_REDACTED_FIELDS,
				redactDepth: e.LOG_REDACT_DEPTH
			})
		});
	});

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
