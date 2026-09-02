import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pino } from "pino";
import type { Pool } from "pg";
import pkg from "../package.json" with { type: "json" };
import { type Config, type AppInfoConfig, loadPackageInfo } from "#src/config.ts";
import { buildServer, type Repositories } from "#src/server.ts";

/** Any property read on the result throws — "never connects" is enforced, not asserted. */
const unreachable = <T>(name: string): T =>
	new Proxy({}, {
		get(_t, prop) {
			throw new Error(
				`${name}.${String(prop)} was touched during OpenAPI generation — a route is doing I/O at registration time`
			);
		}
	}) as T;

const pkgInfoConfig: AppInfoConfig = loadPackageInfo(pkg)

/** Hand-built, not loadConfig(): generation stays zero-coupled to env parsing.
 *  The `Config` annotation is the drift guard — adding a section to the schema
 *  breaks this literal at compile time. Sentinel values name their own status:
 *  nothing here is read during generation except what swagger/autoload touch. */
const fakeConfig: Config = Object.freeze({
	app: Object.freeze({ env: "test", name: pkgInfoConfig.name, host: "127.0.0.1", port: 0, isProduction: false }),
	logging: Object.freeze({ level: "fatal", format: "json", pretty: false }),
	database: Object.freeze({ host: "unreachable", port: 1, database: "unused", user: "unused", min: 0, max: 1 }),
	auth: Object.freeze({ ttlSeconds: 1, audience: "openapi-generation", clientsFile: "unused" }),
	rateLimit: Object.freeze({ max: 1 }),
	secretsSpec: Object.freeze({ dir: "unused", databasePasswordFile: "unused", jwtSecretFile: "unused" })
});

function fakeDeps() {
	return {
		appInfo: pkgInfoConfig, // real name/version — they land in the emitted document
		config: fakeConfig,
		logger: pino({ level: "silent" }),
		database: unreachable<Pool>("database"),
		repositories: unreachable<Repositories>("repositories"),
		autoLoadParameters: {
			dir: resolve(import.meta.dirname, "../src/routes"),
			dirNameRoutePrefix: true,
			routeParams: true,
			matchFilter: /route\.(ts|js)$/
		}
	};
}

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

const app = buildServer(fakeDeps());

await app.ready();
const doc = sortRoot(app.swagger() as unknown as Record<string, unknown>);

const outDir = resolve(import.meta.dirname, "../openapi");
mkdirSync(outDir, { recursive: true });                  // writeFileSync will not create directories
writeFileSync(resolve(outDir, "openapi.json"), `${JSON.stringify(doc, null, 2)}\n`);

await app.close();                                       // run plugin onClose hooks; exit clean
