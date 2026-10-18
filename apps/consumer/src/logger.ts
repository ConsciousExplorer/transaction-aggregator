import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
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
	level: z.enum(LOG_LEVELS).default("info"),
	/** Extra field names to redact, on top of BASE_SENSITIVE_FIELDS. */
	redactedFields: z.array(z.string()).default([]),
	/** How deep into a json record should look to redact values. */
	redactDepth: z.number().int().positive().default(3)
});

export type LoggerOptions = z.input<typeof loggerOptionsSchema>;

/**
 * Factory for a pino logger with sensible defaults and redaction of sensitive fields.
 */
function createLogger(options: LoggerOptions = {}) {
	const { level, redactedFields, redactDepth } =
		loggerOptionsSchema.parse(options);

	const sensitiveFields = [
		...new Set([...BASE_SENSITIVE_FIELDS, ...redactedFields])
	];
	const redactPaths: string[] = [];
	for (const field of sensitiveFields) {
		for (let depth = 0; depth < redactDepth; depth += 1) {
			redactPaths.push(`${"*.".repeat(depth)}${field}`);
		}
	}

	return pino({
		level,
		redact: { paths: redactPaths, censor: "[REDACTED]" }
	});
}

// Matched, not cast: an unknown LOG_LEVEL must fall back to the schema default,
// never throw from an import. config.ts validates it properly and fails startup.
const level = LOG_LEVELS.find(
	(candidate) => candidate === process.env.LOG_LEVEL
);

const redactedFields: string[] = [];
for (const field of (process.env.LOG_REDACTED_FIELDS ?? "").split(",")) {
	const trimmed = field.trim();
	if (trimmed !== "") {
		redactedFields.push(trimmed);
	}
}

/** Base logger, used for all logging in this service. */
const baseLogger = createLogger({
	level,
	redactedFields,
	redactDepth: Number(process.env.LOG_REDACT_DEPTH) || undefined
});

/** Child logger tagged with the calling module's name. */
export function createFileLogger(metaUrl: string) {
	return baseLogger.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
