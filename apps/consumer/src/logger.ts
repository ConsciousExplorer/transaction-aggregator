import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { separateByDelimiter } from "./utils/separate-by-delimiter.ts";

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
 * One path per field per level of nesting ("pan", "*.pan", "*.*.pan"), so a
 * field is redacted up to `depth` levels into a logged object.
 */
function buildRedactPaths(redactedFields: string[], depth: number) {
	const sensitiveFields = new Set([
		...BASE_SENSITIVE_FIELDS,
		...redactedFields
	]);

	const redactPaths: string[] = [];
	for (const field of sensitiveFields) {
		for (let nesting = 0; nesting < depth; nesting += 1) {
			redactPaths.push(`${"*.".repeat(nesting)}${field}`);
		}
	}
	return redactPaths;
}

// Read from the environment, not from config: every module creates its logger
// at import, before config loads. A bad value falls back to the default here
// instead of throwing from an import; config.ts validates all three and fails
// startup.
const level =
	LOG_LEVELS.find((candidate) => candidate === process.env.LOG_LEVEL) ?? "info";
const redactedFields = separateByDelimiter(
	process.env.LOG_REDACTED_FIELDS ?? "",
	","
);
const configuredDepth = Number(process.env.LOG_REDACT_DEPTH);
const redactDepth =
	Number.isInteger(configuredDepth) && configuredDepth > 0
		? configuredDepth
		: 3;

/** Base logger, used for all logging in this service. */
const baseLogger = pino({
	level,
	redact: {
		paths: buildRedactPaths(redactedFields, redactDepth),
		censor: "[REDACTED]"
	}
});

/** Child logger tagged with the calling module's name. */
export function createFileLogger(metaUrl: string) {
	return baseLogger.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
