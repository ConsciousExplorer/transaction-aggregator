import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import pkg from "../package.json" with { type: "json" };
import { loadConfig, loadPackageInfo } from "./config.ts";
import { createLogger } from "./logger.ts";
import { loadSecrets } from "./utils/secrets.ts";

export const config = loadConfig(process.env);
export const appInfo = loadPackageInfo(pkg);
export const secrets = loadSecrets(config.secretsSpec);
export const baseLogger = createLogger(config.logging);

/** Child logger tagged with the calling module's name. */
export function fileLogger(metaUrl: string): Logger {
	return baseLogger.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
