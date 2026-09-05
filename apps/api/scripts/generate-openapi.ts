import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { buildServer } from "#src/server.ts";
import { loadPackageInfo } from "#src/config.ts";

// 
const packageInfoConfig = loadPackageInfo(packageJson)

/** JSON.stringify preserves insertion order; sorting makes regeneration
 *  deterministic so openapi.json diffs show real contract changes only. */
function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, sortKeysDeep(v)])
		);
	return value;
}

/** The ROOT object alone keeps the conventional OpenAPI key order — a plain
 *  alphabetical sort files "openapi": "3.0.3" under info, where no reader
 *  looks for it. Known keys in spec order, unknown keys alphabetical after;
 *  everything BELOW the root still gets the full deep sort. Deterministic
 *  either way — this trades alphabetical for conventional at one level. */
const ROOT_ORDER = ["openapi", "info", "servers", "tags", "paths", "components", "security", "externalDocs"];
function sortRoot(doc: Record<string, unknown>): Record<string, unknown> {
	const rank = (k: string) => {
		const i = ROOT_ORDER.indexOf(k);
		return i === -1 ? ROOT_ORDER.length : i;
	};
	return Object.fromEntries(
		Object.entries(doc)
			.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
			.map(([k, v]) => [k, sortKeysDeep(v)])
	);
}

const app = buildServer({
	appInfo: packageInfoConfig,
	pluginAutoLoadParameters: {
			dir: resolve(import.meta.dirname, "../src/plugins"),
			routeParams: true
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
