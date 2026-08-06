import { z } from "zod";

export const AvroSchemaObject = z.object({
	subject: z.string(),
	version: z.number().int().positive(),
	id: z.number().int().positive(),
	schemaType: z.literal("AVRO").default("AVRO"),

	// Validates that the field is a valid JSON string and an AVRO record
	schema: z.string().refine(
		(val) => {
			try {
				const parsed = JSON.parse(val);
				// Basic check to ensure it looks like a valid AVRO record schema
				return (
					parsed && parsed.type === "record" && Array.isArray(parsed.fields)
				);
			} catch {
				return false;
			}
		},
		{
			message:
				"The schema field must be a valid JSON string representing an AVRO record structure."
		}
	)
});
