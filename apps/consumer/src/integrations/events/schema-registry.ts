// Native schema registry

import { UserError } from "@platformatic/kafka";
import { z } from "zod";
import { AvroSchemaObject } from "#src/schemas/avro.ts";

export class SchemaRegistryError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "SchemaRegistryError";
	}
}

async function registryFetch<S extends z.ZodType>(
	url: string,
	schema: S
): Promise<z.infer<S>> {
	const response = await fetch(url);

	if (!response.ok) {
		throw new UserError(
			`Schema registry request failed: [HTTP ${response.status}] ${url}`,
			{
				cause: await response.json().catch(() => undefined)
			}
		);
	}

	return schema.parse(await response.json());
}

export function getSubjectVersion(
	registryUrl: string,
	subject: string,
	version: number
) {
	return registryFetch(
		`${registryUrl}/subjects/${subject}/versions/${version}`,
		AvroSchemaObject
	);
}

export function getSubjectVersions(registryUrl: string, subject: string) {
	return registryFetch(
		`${registryUrl}/subjects/${subject}/versions`,
		z.array(z.number().int().positive())
	);
}

export function getLatestSubjectVersion(registryUrl: string, subject: string) {
	return registryFetch(
		`${registryUrl}/subjects/${subject}/versions/latest`,
		AvroSchemaObject
	);
}

export function getSchemaById(registryUrl: string, id: number) {
	return registryFetch(`${registryUrl}/schemas/ids/${id}`, AvroSchemaObject);
}
