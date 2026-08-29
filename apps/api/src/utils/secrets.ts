import { readFileSync } from "node:fs";
import { join } from "node:path";

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
