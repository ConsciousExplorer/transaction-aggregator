import { type Logger, pino } from "pino";

/**
 * Stands in for `#src/runtime.ts` under `--conditions=test-runtime`, so a
 * module under test can log without loading config or reading secret files.
 * Exports must match runtime.ts by name and signature.
 */
export const baseLogger: Logger = pino({ level: "silent" });

export function fileLogger(_metaUrl: string): Logger {
	return baseLogger;
}
