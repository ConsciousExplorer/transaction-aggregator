// Fails when a schema can't read records written with the version it replaces:
// the registry's BACKWARD rule, checked without a registry. The registry
// refuses an incompatible version, so one must never reach main, where
// schemas-register would fail on it.
//
// Two checks:
// - each top-level schemas/<name>.avsc against the same file on a base ref
// - each schemas/v<N>/<name>.avsc against schemas/<name>.avsc, the version it
//   evolves from
//
// Usage: node scripts/check-schema-compatibility.ts [base ref]  (default origin/main)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import avsc from "avsc";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const SCHEMAS_DIR = join(REPOSITORY_ROOT, "schemas");

// The generator's annotations, which register.py strips before registering
const GENERATOR_ANNOTATION = "arg.properties";

function stripGeneratorAnnotations(node: unknown): unknown {
	if (Array.isArray(node)) {
		const items = [];
		for (const item of node) {
			items.push(stripGeneratorAnnotations(item));
		}
		return items;
	}

	if (node !== null && typeof node === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			if (key !== GENERATOR_ANNOTATION) {
				result[key] = stripGeneratorAnnotations(value);
			}
		}
		return result;
	}

	return node;
}

function parseSchema(content: string) {
	return avsc.Type.forSchema(
		stripGeneratorAnnotations(JSON.parse(content)) as avsc.Schema
	);
}

// undefined when the file doesn't exist on the base ref: a new schema has no
// earlier version to stay compatible with.
function readBaseContent(path: string, baseRef: string) {
	try {
		return execFileSync("git", ["show", `${baseRef}:${path}`], {
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		});
	} catch {
		return undefined;
	}
}

function listSchemaFiles(directory: string) {
	const files = [];
	for (const file of readdirSync(directory)) {
		if (file.endsWith(".avsc")) {
			files.push(file);
		}
	}
	return files.sort();
}

function listVersionDirectories() {
	const directories = [];
	for (const entry of readdirSync(SCHEMAS_DIR, { withFileTypes: true })) {
		if (entry.isDirectory() && /^v\d+$/.test(entry.name)) {
			directories.push(entry.name);
		}
	}
	return directories.sort();
}

// createResolver throws when the reader can't read the writer's records, e.g.
// an added field without a default or a changed field type.
function checkCanRead(reader: string, writer: string, label: string) {
	try {
		parseSchema(reader).createResolver(parseSchema(writer));
		console.log(`✓ ${label}`);
		return true;
	} catch (error) {
		console.error(`✗ ${label}: ${(error as Error).message}`);
		return false;
	}
}

function checkAgainstBase(baseRef: string) {
	let passed = true;

	for (const file of listSchemaFiles(SCHEMAS_DIR)) {
		const path = `schemas/${file}`;
		const baseContent = readBaseContent(path, baseRef);
		if (baseContent === undefined) {
			console.log(`✓ ${path} is new on this branch`);
			continue;
		}
		const current = readFileSync(join(SCHEMAS_DIR, file), "utf8");
		if (!checkCanRead(current, baseContent, `${path} reads ${baseRef}'s records`)) {
			passed = false;
		}
	}

	return passed;
}

function checkVersionDirectories() {
	let passed = true;

	for (const directory of listVersionDirectories()) {
		for (const file of listSchemaFiles(join(SCHEMAS_DIR, directory))) {
			if (!existsSync(join(SCHEMAS_DIR, file))) {
				console.error(
					`✗ schemas/${directory}/${file} has no schemas/${file} to evolve from`
				);
				passed = false;
				continue;
			}
			const previous = readFileSync(join(SCHEMAS_DIR, file), "utf8");
			const next = readFileSync(join(SCHEMAS_DIR, directory, file), "utf8");
			const label = `schemas/${directory}/${file} reads schemas/${file}'s records`;
			if (!checkCanRead(next, previous, label)) {
				passed = false;
			}
		}
	}

	return passed;
}

const baseRef = process.argv[2] ?? "origin/main";

const baseChecksPassed = checkAgainstBase(baseRef);
const versionChecksPassed = checkVersionDirectories();

if (!baseChecksPassed || !versionChecksPassed) {
	process.exit(1);
}
