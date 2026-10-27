import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pino } from "pino";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait
} from "testcontainers";
import { createPool } from "#src/integrations/database/pool.ts";
import { readSecretFromFile } from "#src/utils/secrets.ts";

/**
 * Create the exact same database that will be
 * used in this project to simulate the "production" environment.
 */
const REPOSITORY_ROOT = join(import.meta.dirname, "../../../../..");
const POSTGRES_IMAGE_CONTEXT = join(REPOSITORY_ROOT, "infrastructure/postgres");
const INITDB_DIRECTORY = join(
	REPOSITORY_ROOT,
	"infrastructure/postgres/initdb"
);
const MIGRATIONS_DIRECTORY = join(REPOSITORY_ROOT, "database/migrations");
const SECRETS_DIRECTORY = join(REPOSITORY_ROOT, "secrets");

// Built on the first run, then reused from Docker's build cache
const POSTGRES_IMAGE_NAME = "txn-agg-postgres-test";

/**
 * Required Postgres configurations
 */
const POSTGRES_COMMAND = [
	"postgres",
	"-c",
	"shared_preload_libraries=pg_stat_statements,pg_cron",
	"-c",
	"cron.database_name=txn_agg",
	"-c",
	"cron.use_background_workers=on",
	"-c",
	"max_worker_processes=16"
];

/**
 * Log when the database is ready to accept connections.
 */
const READY_LOG_LINE = /database system is ready to accept connections/;

/** A pool on the test database as one of the logins initdb creates */
export function connectAs(
	container: StartedTestContainer,
	user: string,
	passwordSecretName: string
) {
	return createPool(
		{
			host: container.getHost(),
			port: container.getMappedPort(5432),
			database: "txn_agg",
			user,
			password: readSecretFromFile(SECRETS_DIRECTORY, passwordSecretName),
			min: 0,
			max: 4
		},
		pino({ level: "silent" })
	);
}

/**
 * A fresh Postgres with the roles and every migration applied. admin owns the
 * tables, as in compose, so it runs the migrations and inserts each test's
 * rows. The code under test runs as api_write, the API's own login.
 */
export async function startTestDatabase() {
	const image = await GenericContainer.fromDockerfile(
		POSTGRES_IMAGE_CONTEXT
	).build(POSTGRES_IMAGE_NAME, { deleteOnExit: false });

	const container = await image
		.withEnvironment({
			POSTGRES_USER: "postgres",
			POSTGRES_PASSWORD: "postgres",
			POSTGRES_DB: "postgres"
		})
		.withCommand(POSTGRES_COMMAND)
		.withCopyDirectoriesToContainer([
			{ source: INITDB_DIRECTORY, target: "/docker-entrypoint-initdb.d" }
		])
		.withExposedPorts(5432)
		.withWaitStrategy(Wait.forLogMessage(READY_LOG_LINE, 2))
		.withStartupTimeout(120_000)
		.start();

	const adminPool = connectAs(container, "admin", "admin_password");
	const adminDatabase = drizzle(adminPool);
	await migrate(adminDatabase, { migrationsFolder: MIGRATIONS_DIRECTORY });

	const apiPool = connectAs(container, "api_write", "api_write_password");
	const apiDatabase = drizzle(apiPool);

	return { container, adminPool, adminDatabase, apiPool, apiDatabase };
}

export type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>;

export async function stopTestDatabase(database: TestDatabase) {
	await database.apiPool.end();
	await database.adminPool.end();
	await database.container.stop();
}
