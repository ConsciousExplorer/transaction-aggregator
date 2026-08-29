// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

import { readSecretFromFile } from "#src/config.ts";

const DB_USER = 'api_read'
const DB_HOST = 'localhost'
const DB_NAME = 'txn_agg'
const DB_PORT = Number('5432')
const DB_PASSWORD = readSecretFromFile('./secrets', 'api_read_password' )


export default defineConfig({
    dialect: "postgresql",
    out: "./src/integrations/database/schemas",
    dbCredentials: {
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            ssl: false
            },
    schemaFilter: ['public'],
    tablesFilter: ["!*_p2025*", "!*_p2026*"]
});
