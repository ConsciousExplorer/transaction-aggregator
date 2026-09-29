import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { type Logger, pino } from "pino";

// Imports nothing but pino, so a module can log without evaluating runtime.ts
// (config + secrets). Pino children copy the root's level, transport and
// redaction when they are created, so the root must be replaced before any
// child exists — hence the guard rather than a settable level.
let root: Logger = pino({ level: "silent" });
let childCreated = false;

export function configureLogging(logger: Logger): void {
	if (childCreated) {
		throw new Error(
			"configureLogging() ran after a module logger was created; import #src/runtime.ts first"
		);
	}
	root = logger;
}

/** Child logger tagged with the calling module's name. */
export function fileLogger(metaUrl: string): Logger {
	childCreated = true;
	return root.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
