import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

// Runner config: migrations are hand-written SQL; this names where they live
// and how `drizzle-kit migrate` connects. `schema` is a path to TypeScript
// schema files (not a Postgres schema name), and drizzle-kit refuses to run
// `generate` — even `--custom` — unless it resolves to at least one real file.
// No defaults: a missing variable stops the run here instead of connecting
// somewhere unintended. drizzle-kit loads ./.env itself on the laptop (real env
// vars win over it); the compose migrate service sets them directly.
const REQUIRED_ENV_VARS = [
	"SECRET_DIR",
	"DATABASE_PASSWORD_SECRET_NAME",
	"DATABASE_HOST",
	"DATABASE_PORT",
	"DATABASE_NAME",
	"DATABASE_USER"
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

function readRequiredEnv(): Record<RequiredEnvVar, string> {
	const env: Partial<Record<RequiredEnvVar, string>> = {};
	const missing: string[] = [];

	for (const name of REQUIRED_ENV_VARS) {
		const value = process.env[name];
		if (value === undefined || value === "") {
			missing.push(name);
		} else {
			env[name] = value;
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(", ")}`
		);
	}

	return env as Record<RequiredEnvVar, string>;
}

const env = readRequiredEnv();
const password = readFileSync(
	join(env.SECRET_DIR, env.DATABASE_PASSWORD_SECRET_NAME),
	"utf-8"
).trim();

export default defineConfig({
	schema: "./schema.ts",
	dialect: "postgresql",
	out: "./migrations",
	dbCredentials: {
		host: env.DATABASE_HOST,
		port: Number(env.DATABASE_PORT),
		database: env.DATABASE_NAME,
		user: env.DATABASE_USER,
		password,
		ssl: false
	}
});
