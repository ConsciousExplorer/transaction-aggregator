import { z } from "zod";

// Validates that the field is a valid JSON string and an AVRO record
const AvroSchemaString = z.string().refine(
	(value) => {
		try {
			const parsed = JSON.parse(value);
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

/** The two fields the deserialiser reads from a registry subject version */
export const AvroSchemaObject = z.object({
	id: z.number().int().positive(),
	schema: AvroSchemaString
});
