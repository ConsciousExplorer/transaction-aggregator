import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "#src/config.ts";

export type Secrets = Readonly<
	Record<keyof Config["secretsSpec"]["secrets"], string>
>;

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
	const secrets = {} as Record<string, string>;
	for (const [name, fileName] of Object.entries(spec.secrets)) {
		secrets[name] = readSecretFromFile(spec.dir, fileName);
	}
	return Object.freeze(secrets) as Secrets;
}
