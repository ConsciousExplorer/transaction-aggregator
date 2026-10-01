import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type Logger, pino } from "pino";
import { z } from "zod";

/** The levels pino understands. config.ts reuses this for LOG_LEVEL. */
export const LOG_LEVELS = [
	"fatal",
	"error",
	"warn",
	"info",
	"debug",
	"trace",
	"silent"
] as const;

/** Baseline PAN fields — always redacted, config can only add to this. */
const BASE_SENSITIVE_FIELDS = [
	"pan",
	"PAN",
	"cardPan",
	"cardNumber",
	"card_number",
	"cardNo",
	"primaryAccountNumber"
];

/**
 * Logger signature
 */
export const loggerOptionsSchema = z.object({
	level: z.enum(LOG_LEVELS).default("warn"),
	pretty: z.boolean().default(false),
	/** Extra field names to redact, on top of BASE_SENSITIVE_FIELDS. */
	redactedFields: z.array(z.string()).default([]),
	/**
	 * How deep into a json record should look to redact values
	 */
	redactDepth: z.number().int().positive().default(3)
});

export type LoggerOptions = z.input<typeof loggerOptionsSchema>;

function createLogger(options: LoggerOptions = {}): Logger {
	const { level, pretty, redactedFields, redactDepth } =
		loggerOptionsSchema.parse(options);

	const sensitiveFields = [
		...new Set([...BASE_SENSITIVE_FIELDS, ...redactedFields])
	];
	const redactPaths = sensitiveFields.flatMap((field) =>
		Array.from(
			{ length: redactDepth },
			(_, depth) => `${"*.".repeat(depth)}${field}`
		)
	);

	return pino({
		level,
		...(pretty && {
			transport: { target: "pino-pretty", options: { colorize: true } }
		}),
		redact: { paths: redactPaths, censor: "[REDACTED]" }
	});
}

// Matched, not cast: an unknown LOG_LEVEL must fall back to the schema default,
// never throw from an import. config.ts validates it properly and fails startup.
const level = LOG_LEVELS.find(
	(candidate) => candidate === process.env.LOG_LEVEL
);

const redactedFields = (process.env.LOG_REDACTED_FIELDS ?? "")
	.split(",")
	.map((field) => field.trim())
	.filter(Boolean);

const baseLogger = createLogger({
	level,
	pretty: process.env.LOG_PRETTY === "true",
	redactedFields,
	redactDepth: Number(process.env.LOG_REDACT_DEPTH) || undefined
});

/** Child logger tagged with the calling module's name. */
export function fileLogger(metaUrl: string): Logger {
	return baseLogger.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
