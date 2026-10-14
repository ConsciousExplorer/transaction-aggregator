import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { buildServer } from "#src/server.ts";
import { loadConfig, loadPackageInfo } from "#src/config.ts";

// 
const packageInfoConfig = loadPackageInfo(packageJson)

/** JSON.stringify preserves insertion order; sorting makes regeneration
 *  deterministic so openapi.json diffs show real contract changes only. 
 * 
*/
function sortKeysDeep(value: unknown) {
	if (Array.isArray(value)) {
		const sortedItems: unknown[] = [];
		for (const item of value) {
			sortedItems.push(sortKeysDeep(item));
		}
		return sortedItems;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value).sort(([firstKey], [secondKey]) =>
			firstKey.localeCompare(secondKey)
		);
		const sorted: Record<string, unknown> = {};
		for (const [key, entryValue] of entries) {
			sorted[key] = sortKeysDeep(entryValue);
		}
		return sorted;
	}
	return value;
}

/** The ROOT object alone keeps the conventional OpenAPI key order — a plain
 *  alphabetical sort files "openapi": "3.0.3" under info, where no reader
 *  looks for it. Known keys in spec order, unknown keys alphabetical after;
 *  everything BELOW the root still gets the full deep sort. Deterministic
 *  either way — this trades alphabetical for conventional at one level. */
const ROOT_ORDER = ["openapi", "info", "components", "servers", "tags", "paths", "security", "externalDocs"];
function rankRootKey(key: string) {
	const index = ROOT_ORDER.indexOf(key);
	return index === -1 ? ROOT_ORDER.length : index;
}

function sortRoot(doc: Record<string, unknown>) {
	const entries = Object.entries(doc).sort(
		([firstKey], [secondKey]) =>
			rankRootKey(firstKey) - rankRootKey(secondKey) ||
			firstKey.localeCompare(secondKey)
	);
	const sorted: Record<string, unknown> = {};
	for (const [key, entryValue] of entries) {
		sorted[key] = sortKeysDeep(entryValue);
	}
	return sorted;
}

// Defaults only, so the contract never depends on the shell it is generated in
const { queryWindow } = loadConfig({});

const app = buildServer({
	appInfo: packageInfoConfig,
	queryWindow,
	pluginAutoLoadParameters: {
			dir: resolve(import.meta.dirname, "../src/plugins"),
			routeParams: true,
			enableSwagger: true
		},
	routeAutoLoadParameters: {
			dir: resolve(import.meta.dirname, "../src/routes"),
			dirNameRoutePrefix: true,
			routeParams: true,
			matchFilter: /route\.(ts|js)$/
		}
});

await app.ready();
const doc = sortRoot(app.swagger() as unknown as Record<string, unknown>);

const outDir = resolve(import.meta.dirname, "../openapi");
mkdirSync(outDir, { recursive: true });                  // writeFileSync will not create directories
writeFileSync(resolve(outDir, "openapi.json"), `${JSON.stringify(doc, null, 2)}\n`);

await app.close();                                       // run plugin onClose hooks; exit clean
