import process from "node:process";
import { loadConfig } from "./config.ts";
import { loadSecrets } from "./utils/secrets.ts";

export const config = loadConfig(process.env);
export const secrets = loadSecrets(config.secretsSpec);
