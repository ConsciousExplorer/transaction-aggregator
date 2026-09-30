import { z } from "zod";

// Validates that the field is a valid JSON string and an AVRO record
const AvroSchemaString = z.string().refine(
	(val) => {
		try {
			const parsed = JSON.parse(val);
			// Basic check to ensure it looks like a valid AVRO record schema
			return parsed && parsed.type === "record" && Array.isArray(parsed.fields);
		} catch {
			return false;
		}
	},
	{
		message:
			"The schema field must be a valid JSON string representing an AVRO record structure."
	}
);

export const AvroSchemaObject = z.object({
	subject: z.string(),
	version: z.number().int().positive(),
	id: z.number().int().positive(),
	schemaType: z.literal("AVRO").default("AVRO"),
	schema: AvroSchemaString
});

// GET /schemas/ids/{id} answers with the schema only — no subject, version or id
export const SchemaById = z.object({
	schema: AvroSchemaString
});
