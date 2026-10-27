// Fails unless an app's version is higher than the same file's version on a
// base ref. CI runs it on a pull request into main for every app that changed,
// so main never receives a change under a version it has already seen.
//
// Usage: node scripts/check-version-bump.ts <manifest> [base ref]
//   manifest: apps/<app>/package.json or apps/producers/pyproject.toml
//   base ref: defaults to origin/main
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");

// Plain major.minor.patch: the apps don't use pre-release or build suffixes
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function readVersionFromPackageJson(content: string) {
	return JSON.parse(content).version as string;
}

// Reads `version = "x.y.z"` from the [project] table only, so a tool's own
// version setting elsewhere in the file can't be mistaken for the app's.
function readVersionFromPyproject(content: string) {
	let inProjectTable = false;

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) {
			inProjectTable = trimmed === "[project]";
			continue;
		}
		const match = /^version\s*=\s*"([^"]+)"/.exec(trimmed);
		if (inProjectTable && match) {
			return match[1];
		}
	}

	throw new Error("No version in the [project] table");
}

function readVersion(manifest: string, content: string) {
	if (manifest.endsWith("package.json")) {
		return readVersionFromPackageJson(content);
	}
	if (manifest.endsWith("pyproject.toml")) {
		return readVersionFromPyproject(content);
	}
	throw new Error(`Unsupported manifest: ${manifest}`);
}

function parseVersion(version: string) {
	const match = VERSION_PATTERN.exec(version);
	if (!match) {
		throw new Error(`Not a major.minor.patch version: ${version}`);
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isHigherVersion(current: string, base: string) {
	const currentParts = parseVersion(current);
	const baseParts = parseVersion(base);

	for (const [index, currentPart] of currentParts.entries()) {
		if (currentPart !== baseParts[index]) {
			return currentPart > baseParts[index];
		}
	}

	return false;
}

// undefined when the manifest doesn't exist on the base ref: a new app has no
// earlier version to beat.
function readBaseContent(manifest: string, baseRef: string) {
	try {
		return execFileSync("git", ["show", `${baseRef}:${manifest}`], {
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"]
		});
	} catch {
		return undefined;
	}
}

function checkVersionBump(manifest: string, baseRef: string) {
	const current = readVersion(
		manifest,
		readFileSync(resolve(REPOSITORY_ROOT, manifest), "utf8")
	);
	const baseContent = readBaseContent(manifest, baseRef);

	if (baseContent === undefined) {
		console.log(`${manifest}: new on this branch, version ${current}`);
		return true;
	}

	const base = readVersion(manifest, baseContent);
	if (isHigherVersion(current, base)) {
		console.log(`${manifest}: ${base} → ${current}`);
		return true;
	}

	console.error(
		`${manifest}: version ${current} must be higher than ${baseRef}'s ${base}. Bump it in this change.`
	);
	return false;
}

const [manifest, baseRef = "origin/main"] = process.argv.slice(2);

if (!manifest) {
	console.error(
		"Usage: node scripts/check-version-bump.ts <manifest> [base ref]"
	);
	process.exit(2);
}

if (!checkVersionBump(manifest, baseRef)) {
	process.exit(1);
}
