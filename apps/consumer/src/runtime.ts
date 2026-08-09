/**
 * Process-wide singletons.
 *
 * This module must stay a leaf - it may import factories, never the modules
 * that consume it. ESM evaluates a module before any module that imports it,
 * so everything downstream is guaranteed a fully built logger without any
 * explicit initialisation step. Putting these in app.ts instead creates a
 * cycle, and the consumers then read `baseLogger` while it is still in its
 * temporal dead zone.
 */
import { basename } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";

export const config = loadConfig(process.env);

export const baseLogger = createLogger(config.logging);

/** Child logger tagged with the calling module's name. */
export function fileLogger(metaUrl: string): Logger {
	return baseLogger.child({ module: basename(fileURLToPath(metaUrl), ".ts") });
}
