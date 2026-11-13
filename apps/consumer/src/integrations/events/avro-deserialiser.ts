import {
	type BeforeDeserializationHook,
	type BeforeHookPayloadType,
	UserError
} from "@platformatic/kafka";
import avsc from "avsc";
import { UnknownSchemaIdError } from "#src/errors/consumer-errors.ts";
import { createFileLogger } from "#src/logger.ts";
import {
	getSchemaById,
	getSubjectVersion,
	getSubjectVersions
} from "./schema-registry.ts";

const logger = createFileLogger(import.meta.url);

const MAGIC_BYTE = 0;
const SCHEMA_ID_OFFSET = 1;
const WIRE_HEADER_BYTES = 5; // magic byte + int32 schema id

/** Every schema this process can decode with, by registry schema id. */
export type SchemaTypes = Map<number, avsc.Type>;

/** The bytes as they arrived travel with the decoded value, for the DLQ. */
export interface DecodedValue<T> {
	raw: Buffer;
	value: T;
}

function isConfluentFramed(payload: Buffer) {
	return (
		payload.length >= WIRE_HEADER_BYTES && payload.readUInt8(0) === MAGIC_BYTE
	);
}

/**
 * Decodes a record with the schema it was written with, the one its frame
 * names. A field that schema has and this consumer doesn't know is decoded and
 * then left unread, which is how a producer can add one.
 */
export function deserialise<T>(types: SchemaTypes, data?: Buffer) {
	if (!data?.length) return undefined;

	if (!isConfluentFramed(data)) {
		throw new UserError(`Not Confluent wire format (${data.length} bytes)`);
	}

	const schemaId = data.readInt32BE(SCHEMA_ID_OFFSET);
	const type = types.get(schemaId);

	if (!type) {
		throw new UnknownSchemaIdError(
			`Unknown schema id ${schemaId}; loaded: ${[...types.keys()].join(", ")}`
		);
	}

	return {
		raw: data,
		value: type.fromBuffer(data.subarray(WIRE_HEADER_BYTES)) as T
	};
}

/**
 * Loads every registered version of the subject, once, at startup, so a
 * registry that can't be reached stops the boot. A version registered later is
 * loaded by the missing-schema loader when its first record arrives.
 */
export async function loadSubjectSchemas(registryUrl: string, subject: string) {
	const types: SchemaTypes = new Map();

	const versions = await getSubjectVersions(registryUrl, subject);
	for (const version of versions) {
		const { id, schema } = await getSubjectVersion(
			registryUrl,
			subject,
			version
		);
		types.set(id, avsc.Type.forSchema(JSON.parse(schema)));
	}

	logger.info(
		{ subject, schemaIds: [...types.keys()] },
		`Loaded ${types.size} Avro schema(s)`
	);

	return types;
}

export function createAvroDeserialiser<T>(types: SchemaTypes) {
	return function deserialiseValue(data?: Buffer) {
		return deserialise<T>(types, data);
	};
}

/**
 * The schema id of a framed message value that no loaded schema has. Keys,
 * headers, tombstones and unframed bytes name no schema, and a loaded id has
 * nothing missing, so all of those are undefined.
 */
function findMissingSchemaId(
	types: SchemaTypes,
	payload: Buffer | null,
	payloadType: BeforeHookPayloadType
) {
	if (payloadType !== "value" || payload === null) return undefined;
	if (!isConfluentFramed(payload)) return undefined;

	const schemaId = payload.readInt32BE(SCHEMA_ID_OFFSET);
	if (types.has(schemaId)) return undefined;

	return schemaId;
}

/** Fetches one schema by id and adds it to the loaded schemas. */
async function loadSchema(
	registryUrl: string,
	types: SchemaTypes,
	schemaId: number
) {
	const { schema } = await getSchemaById(registryUrl, schemaId);
	types.set(schemaId, avsc.Type.forSchema(JSON.parse(schema)));

	logger.info({ schemaId }, "Loaded an Avro schema registered after startup");
}

/**
 * The client calls the returned hook for every key, value and header of a
 * fetch, and decodes nothing until each call has settled. That is the one
 * place a schema can be fetched, because decoding itself is synchronous. A
 * producer that starts writing a new schema version therefore costs one
 * registry read and no restart.
 *
 * A registry that can't supply the schema rejects with a SchemaRegistryError.
 * The client records that on the message, and the deserialisation error
 * handler stops on it.
 */
export function createMissingSchemaLoader(
	registryUrl: string,
	types: SchemaTypes
): BeforeDeserializationHook {
	return async function loadMissingSchema(payload, payloadType) {
		const schemaId = findMissingSchemaId(types, payload, payloadType);
		if (schemaId === undefined) return;

		await loadSchema(registryUrl, types, schemaId);
	};
}
