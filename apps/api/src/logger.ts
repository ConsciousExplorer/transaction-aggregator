import { type Logger, pino } from "pino";
import { z } from "zod";

/** The levels pino understands. config.ts reuses this for LOG_LEVEL. */
export const LOG_LEVELS = [
	"fatal",
	"error",
	"warn",
	"info",
	"debug",
	"trace"
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

export function createLogger(options: LoggerOptions = {}): Logger {
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
