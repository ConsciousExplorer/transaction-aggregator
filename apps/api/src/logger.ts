import { pino } from "pino";

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

/** config.logging, which config.ts has already validated */
export interface LoggerOptions {
	level: (typeof LOG_LEVELS)[number];
	/** Extra field names to redact, on top of BASE_SENSITIVE_FIELDS */
	redactedFields: string[];
	/** How many levels into a logged object a field is still redacted */
	redactDepth: number;
}

export function createLogger(options: LoggerOptions) {
	const sensitiveFields = new Set([
		...BASE_SENSITIVE_FIELDS,
		...options.redactedFields
	]);

	// One path per field per level of nesting: "pan", "*.pan", "*.*.pan"
	const redactPaths: string[] = [];
	for (const field of sensitiveFields) {
		for (let nesting = 0; nesting < options.redactDepth; nesting += 1) {
			redactPaths.push(`${"*.".repeat(nesting)}${field}`);
		}
	}

	return pino({
		level: options.level,
		redact: { paths: redactPaths, censor: "[REDACTED]" }
	});
}
