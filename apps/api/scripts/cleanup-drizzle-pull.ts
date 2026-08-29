import { readdirSync, rmSync } from "node:fs"
import path from "node:path"


const schemaDirectory = path.resolve('src/integrations/database/schemas')
const filesToKeep = new Set([
    'schema.ts', 'relations.ts', 'partitioned.ts'
])

// Determine is we are in the correct directory and if it eixsts
if (!readdirSync(schemaDirectory)) {
    console.log('Schema directory does not exist')
    process.exit(0)
}

// Loop over schemaDirectory and remove files that are not needed by application
for (const entry of readdirSync(schemaDirectory)) {
    if (filesToKeep.has(entry)) 
        continue;

    rmSync(path.join(schemaDirectory, entry), {
        recursive: true,
        force: true
    })
}