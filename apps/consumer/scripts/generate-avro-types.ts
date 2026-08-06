import { mkdirSync, read, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve} from 'node:path'
import { avroToTypeScript, type RecordType } from "avro-typescript"

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../../schemas")
const OUT_DIR = resolve(import.meta.dirname, "../src/generated")

mkdirSync(OUT_DIR, {recursive: true})

const header = "// Generated from repository schemas. Run npm run scripts:generate-avro \n"

const files = readdirSync(SCHEMAS_DIR).filter((file) => file.endsWith(".avsc")).sort()

for (const file of files) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), "utf-8")) as RecordType
    const name = basename(file, ".avsc").replaceAll("-", "_")
    writeFileSync(join(OUT_DIR, `${name}.ts`), header + avroToTypeScript(schema) + "\n");
    console.log(`Generated a new file for ${name}.ts\n`)
}