import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../../schemas");
const OUT_DIR = resolve(import.meta.dirname, "../src/schemas");

interface AvroField {
	name: string;
	type: unknown;
	doc?: string;
}

interface AvroRecord {
	type: "record";
	name: string;
	doc?: string;
	fields: AvroField[];
}

const header =
	"// Generated from repository schemas — do not edit. Run npm run schema:generate\n";

function zodFor(type: unknown, fieldName: string): string {
	if (type === "string") return "z.string()";
	if (type === "long" || type === "int") return "z.number()";
	if (type === "float" || type === "double") return "z.number()";
	if (type === "boolean") return "z.boolean()";

	// Logical types (uuid, timestamp-millis) annotate a base type. The wire
	// guarantee is the base type, so the schema mirrors it without tightening —
	// a stricter rule here would reject messages Avro considers valid.
	if (typeof type === "object" && type !== null && "type" in type) {
		return zodFor((type as { type: unknown }).type, fieldName);
	}

	throw new Error(
		`No zod mapping for Avro type of field "${fieldName}": ${JSON.stringify(type)}`
	);
}

function lowerFirst(name: string): string {
	return name.charAt(0).toLowerCase() + name.slice(1);
}

function emitSchema(record: AvroRecord): string {
	const schemaName = `${lowerFirst(record.name)}Schema`;
	const fieldLines: string[] = [];

	for (const field of record.fields) {
		const lines: string[] = [];
		if (field.doc) lines.push(`\t// ${field.doc.replaceAll("\n", " ")}`);
		lines.push(`\t${field.name}: ${zodFor(field.type, field.name)}`);
		fieldLines.push(lines.join("\n"));
	}

	const parts: string[] = [header, 'import { z } from "zod";', ""];
	if (record.doc) parts.push(`/** ${record.doc} */`);
	parts.push(`export const ${schemaName} = z.object({`);
	parts.push(fieldLines.join(",\n"));
	parts.push("});");
	parts.push("");
	parts.push(`export type ${record.name} = z.infer<typeof ${schemaName}>;`);
	parts.push("");

	return parts.join("\n");
}

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SCHEMAS_DIR)
	.filter((file) => file.endsWith(".avsc"))
	.sort();

for (const file of files) {
	const record = JSON.parse(
		readFileSync(join(SCHEMAS_DIR, file), "utf-8")
	) as AvroRecord;
	const name = basename(file, ".avsc").replaceAll("-", "_");

	writeFileSync(join(OUT_DIR, `${name}.ts`), emitSchema(record));
	console.log(`Generated ${name}.ts (${record.name})`);
}
