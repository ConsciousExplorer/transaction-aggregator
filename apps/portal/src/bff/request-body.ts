import type { z } from "zod";
import { invalidRequestError } from "./problems.ts";

// Parses a write's JSON body against its schema; anything else is a 400 before the API is called
export async function readRequestBody<Schema extends z.ZodType>(
	request: Request,
	schema: Schema
) {
	let value: unknown;
	try {
		value = await request.json();
	} catch {
		throw invalidRequestError("The body must be JSON");
	}
	const body = schema.safeParse(value);
	if (!body.success)
		throw invalidRequestError(
			body.error.issues[0]?.message ?? "The body is not valid"
		);
	return body.data as z.infer<Schema>;
}
