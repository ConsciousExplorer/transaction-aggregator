import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait
} from "testcontainers";
import { createPool } from "#src/integrations/database/pool.ts";
import { readSecretFromFile } from "#src/utils/secrets.ts";

// The tests run against what compose runs: the same image, the same initdb
// scripts, the same migrations, the same access files and the same dev secrets.
const REPOSITORY_ROOT = join(import.meta.dirname, "../../../../..");
const POSTGRES_IMAGE_CONTEXT = join(REPOSITORY_ROOT, "infrastructure/postgres");
const INITDB_DIRECTORY = join(
	REPOSITORY_ROOT,
	"infrastructure/postgres/initdb"
);
const MIGRATIONS_DIRECTORY = join(REPOSITORY_ROOT, "database/migrations");
const ACCESS_DIRECTORY = join(REPOSITORY_ROOT, "database/access");
const SECRETS_DIRECTORY = join(REPOSITORY_ROOT, "secrets");

// Built on the first run, then reused from Docker's build cache.
const POSTGRES_IMAGE_NAME = "txn-agg-postgres-test";

// Compose's postgres command.
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

// The image logs this once for the temporary server that runs the initdb
// scripts, and again when the real server is up
const READY_LOG_LINE = /database system is ready to accept connections/;

/** A pool on the test database as admin or a login from database/access */
export function connectAs(
	container: StartedTestContainer,
	user: string,
	passwordSecretName: string
) {
	return createPool({
		host: container.getHost(),
		port: container.getMappedPort(5432),
		database: "txn_agg",
		user,
		password: readSecretFromFile(SECRETS_DIRECTORY, passwordSecretName),
		min: 0,
		max: 4
	});
}

/**
 * Applies database/access with the command compose's access one-shot runs:
 * the roles and logins, then the grants on the tables. It runs inside the
 * container, where the local socket lets the superuser in without a password.
 */
async function applyAccess(container: StartedTestContainer) {
	const result = await container.exec(
		[
			"psql",
			"--username=postgres",
			"--dbname=txn_agg",
			"--set=ON_ERROR_STOP=1",
			"--single-transaction",
			"--file=/access/roles.sql",
			"--file=/access/grants.sql"
		],
		{ env: { SECRET_DIR: "/secrets" } }
	);

	if (result.exitCode !== 0) {
		throw new Error(`Applying database/access failed: ${result.output}`);
	}
}

/**
 * A fresh Postgres with every migration and database/access applied. admin
 * owns the tables, as in compose, so it runs the migrations and reads back
 * what the consumer wrote. The code under test runs as kafka_consumer, the
 * consumer's own login, so a grant it lacks fails the test as it would in
 * production.
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
			{ source: INITDB_DIRECTORY, target: "/docker-entrypoint-initdb.d" },
			{ source: ACCESS_DIRECTORY, target: "/access" },
			{ source: SECRETS_DIRECTORY, target: "/secrets" }
		])
		.withExposedPorts(5432)
		.withWaitStrategy(Wait.forLogMessage(READY_LOG_LINE, 2))
		.withStartupTimeout(120_000)
		.start();

	const adminPool = connectAs(container, "admin", "admin_password");
	await migrate(drizzle(adminPool), { migrationsFolder: MIGRATIONS_DIRECTORY });
	await applyAccess(container);

	const consumerPool = connectAs(
		container,
		"kafka_consumer",
		"consumer_database_password"
	);

	return { container, adminPool, consumerPool };
}

export type TestDatabase = Awaited<ReturnType<typeof startTestDatabase>>;

/** For a file that stopped its container itself */
export async function closeTestDatabasePools(database: TestDatabase) {
	await database.consumerPool.end();
	await database.adminPool.end();
}

export async function stopTestDatabase(database: TestDatabase) {
	await closeTestDatabasePools(database);
	await database.container.stop();
}
