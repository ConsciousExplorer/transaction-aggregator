import process from "node:process";
import packageJson from "../package.json" with { type: "json" };
import { loadConfig, loadPackageInfo } from "./config.ts";
import { loadSecrets } from "./utils/secrets.ts";

export const config = loadConfig(process.env);
export const appInfo = loadPackageInfo(packageJson);
export const secrets = loadSecrets(config.secretsSpec);
