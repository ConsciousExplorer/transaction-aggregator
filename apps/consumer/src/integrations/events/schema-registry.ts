// Native schema registry

import { z } from "zod";
import { SchemaRegistryError } from "#src/errors/consumer-errors.ts";
import { AvroSchemaObject } from "#src/schemas/avro.ts";

// A registry read is small; a registry that cannot answer within this is down.
const REGISTRY_TIMEOUT_MS = 5_000;

/**
 * Every failure becomes a SchemaRegistryError carrying the HTTP status (or
 * undefined when the registry was unreachable), so the startup failure log
 * tells "not found" from "registry down" without parsing messages.
 */
async function fetchFromRegistry<S extends z.ZodType>(url: string, schema: S) {
	let response: Response;

	try {
		response = await fetch(url, {
			signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
		});
	} catch (error) {
		throw new SchemaRegistryError(`Schema registry unreachable: ${url}`, {
			cause: error,
			status: undefined
		});
	}

	if (!response.ok) {
		throw new SchemaRegistryError(
			`Schema registry request failed: [HTTP ${response.status}] ${url}`,
			{
				cause: await response.json().catch(() => undefined),
				status: response.status
			}
		);
	}

	const body = await response.json().catch(() => undefined);
	const result = schema.safeParse(body);

	if (!result.success) {
		throw new SchemaRegistryError(
			`Schema registry returned an unexpected body: ${url}`,
			{ cause: result.error, status: response.status }
		);
	}

	return result.data;
}

export function getSubjectVersion(
	registryUrl: string,
	subject: string,
	version: number
) {
	return fetchFromRegistry(
		`${registryUrl}/subjects/${subject}/versions/${version}`,
		AvroSchemaObject
	);
}

export function getSubjectVersions(registryUrl: string, subject: string) {
	return fetchFromRegistry(
		`${registryUrl}/subjects/${subject}/versions`,
		z.array(z.number().int().positive())
	);
}
