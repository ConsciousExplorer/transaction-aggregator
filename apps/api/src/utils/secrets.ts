import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "#src/config.ts";

export type Secrets = Readonly<{ databasePassword: string; jwtSecret: string }>;

export function readSecretFromFile(dir: string, fileName: string): string {
	const path = join(dir, fileName);
	try {
		return readFileSync(path, "utf-8").trim();
	} catch (error) {
		throw new Error(`Unable to read secret "${fileName}" from ${path}`, {
			cause: error
		});
	}
}

export function loadSecrets(spec: Config["secretsSpec"]): Secrets {
	return Object.freeze({
		databasePassword: readSecretFromFile(spec.dir, spec.databasePasswordFile),
		jwtSecret: readSecretFromFile(spec.dir, spec.jwtSecretFile)
	});
}
