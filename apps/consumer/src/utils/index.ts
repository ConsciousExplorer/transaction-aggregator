// TODO: Determine if this barrel export is actually correct.
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";

export const config = loadConfig(process.env);
export const baseLogger = createLogger(config.logging);
